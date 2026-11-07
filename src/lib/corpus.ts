/**
 * corpus.ts — where the entry markdown comes from. The only module that reads it.
 *
 * Two layers, the same design as lossless-toolkit-site's corpus.ts:
 *
 *   1. BASELINE: the committed copy under `src/stream/<slug>/`, written by
 *      `pnpm sync` and bundled at build time through `import.meta.glob`. A
 *      cold instance renders from this at once, with no network.
 *   2. OVERLAY: each declared stream's live changelog directory. `syncCorpus()`
 *      lists every stream whose check has gone stale (one conditional request
 *      each, so an unchanged stream costs a free 304) and compares each file's
 *      blob sha with the one already held. Only entries that differ are
 *      fetched. Deletions fall out because the remote listing is the list of
 *      record.
 *
 * A push reaches the site without a rebuild: lossless-hook-relay wakes
 * `/api/content-hook`, which forgets the pushed repo's streams and purges the
 * CDN, and the next render syncs them. Re-running `pnpm sync` only shrinks
 * what a cold instance has to fetch; it is never required for freshness.
 *
 * Fetched entries get exactly the treatment scripts/sync-streams.mjs gives
 * them — the same path denylist, the same roll-up guard, the same provenance
 * stamp — so a live entry and a synced one are byte-identical.
 *
 * Never throws into a page. A stream that fails keeps its last good snapshot.
 */
import manifestRaw from "../config/streams.yaml?raw";
import { parse as parseYaml } from "yaml";

const BASELINE = import.meta.glob<string>("../stream/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

interface StreamSource {
  slug: string;
  repo: string;
  ref: string;
  path: string;
  enabled?: boolean;
}

export const SOURCES: StreamSource[] = (parseYaml(manifestRaw).streams as StreamSource[]).filter(
  (s) => s.enabled !== false,
);

const env = (k: string): string | undefined => (import.meta.env as any)[k] ?? process.env[k];
const token = () => env("GITHUB_TOKEN") ?? env("GITHUB_API_TOKEN");
// CONTENT_SOURCE=baseline pins the committed copy: offline dev, and builds.
const pinned = () => env("CONTENT_SOURCE") === "baseline";

/* ------------------------------------------------------------------ state -- */

interface Held {
  sha: string | undefined;
  text: string;
}

interface StreamState {
  files: Map<string, Held>;
  etag?: string;
  /** When the listing was last confirmed against GitHub. 0 = check on next sync. */
  checked: number;
}

const FROM_SHA = /^from_sha:\s*(\S+)/m;

const state = new Map<string, StreamState>();
for (const s of SOURCES) state.set(s.slug, { files: new Map(), checked: 0 });
for (const [key, text] of Object.entries(BASELINE)) {
  const m = key.match(/\/stream\/([^/]+)\/(.+\.md)$/);
  const st = m && state.get(m[1]);
  if (st) st.files.set(m[2], { sha: text.match(FROM_SHA)?.[1], text });
}

/** Bumped whenever any stream's files change, so derived models rebuild. */
let version = 0;
export const corpusVersion = () => version;

/** Every held entry, keyed `../stream/<slug>/<name>.md` like the glob was. */
export function corpusFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [slug, st] of state) for (const [name, h] of st.files) out[`../stream/${slug}/${name}`] = h.text;
  return out;
}

/** Make the next sync re-list these streams at once. Called by the hook. */
export function forgetStreams(slugs: string[]) {
  for (const slug of slugs) {
    const st = state.get(slug);
    if (st) st.checked = 0;
  }
}

/* ----------------------------------------------------------------- GitHub -- */

// At most 8 requests in flight, as in the toolkit and client-portals-site.
let active = 0;
const queue: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 8) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function gh(path: string, init: { etag?: string; raw?: boolean } = {}) {
  return limited(() => {
    const headers: Record<string, string> = {
      Accept: init.raw ? "application/vnd.github.raw" : "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lossless-changelog",
    };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (init.etag) headers["If-None-Match"] = init.etag;
    return fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  });
}

const blobs = new Map<string, Promise<string>>();
/** One file's source text, memoized by its content-addressed sha. */
function blobText(repo: string, sha: string): Promise<string> {
  const key = `${repo}@${sha}`;
  if (!blobs.has(key)) {
    blobs.set(
      key,
      (async () => {
        const res = await gh(`/repos/${repo}/git/blobs/${sha}`, { raw: true });
        if (!res.ok) throw new Error(`GitHub ${res.status} reading blob ${sha}`);
        return res.text();
      })().catch((e) => {
        blobs.delete(key);
        throw e;
      }),
    );
  }
  return blobs.get(key)!;
}

/* ---------------------------------------------- sync-streams.mjs, mirrored -- */

// Exclusion layer 2 (path denylist) and layer 3 (roll-up guard). Keep in step
// with scripts/sync-streams.mjs.
const DENY = [
  /(^|\/)splash\//,
  /(^|\/)dist\//,
  /(^|\/)node_modules\//,
  /(^|\/)generated-content\//,
  /(^|\/)changelog--/,
  /(^|\/)skills\//,
];
const ROLLUP_KEYS = /^(from|from_path):/m;

function frontmatterOf(text: string): string | null {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  return end === -1 ? null : text.slice(0, end + 4);
}

function stamp(s: StreamSource, name: string, sha: string, raw: string): string {
  const head = `from: ${s.slug}\nfrom_path: ${name}\nfrom_repo: ${s.repo}\nfrom_ref: ${s.ref}\nfrom_sha: ${sha}\n`;
  return raw.startsWith("---") ? raw.replace(/^---\n/, `---\n${head}`) : `---\n${head}---\n\n${raw}`;
}

/* ------------------------------------------------------------------- sync -- */

/** How stale a stream's listing may get on any one instance. Read by the hook. */
export const TTL = 60_000;

async function syncStream(s: StreamSource, st: StreamState): Promise<boolean> {
  const dir = s.path.replace(/\/$/, "");
  const res = await gh(`/repos/${s.repo}/contents/${dir}?ref=${encodeURIComponent(s.ref)}`, { etag: st.etag });
  if (res.status === 304) {
    st.checked = Date.now();
    return false;
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} listing ${s.repo}:${s.ref}/${dir}`);
  const listing = await res.json();
  if (!Array.isArray(listing)) throw new Error(`${s.slug}: expected a directory listing`);

  // Build the whole next snapshot before touching the held one: a failed fetch
  // abandons this stream's sync and keeps the previous snapshot whole.
  const next = new Map<string, Held>();
  await Promise.all(
    (listing as { type: string; name: string; path: string; sha: string }[])
      .filter((f) => f.type === "file" && f.name.endsWith(".md") && !DENY.some((re) => re.test(f.path)))
      .map(async (f) => {
        const held = st.files.get(f.name);
        if (held && held.sha === f.sha) {
          next.set(f.name, held);
          return;
        }
        const raw = await blobText(s.repo, f.sha);
        const fm = frontmatterOf(raw);
        if (fm && ROLLUP_KEYS.test(fm)) return;
        next.set(f.name, { sha: f.sha, text: stamp(s, f.name, f.sha, raw) });
      }),
  );

  const changed =
    next.size !== st.files.size || [...next].some(([name, h]) => st.files.get(name)?.sha !== h.sha);
  if (changed) st.files = next;
  st.etag = res.headers.get("etag") ?? undefined;
  st.checked = Date.now();
  return changed;
}

let inflight: Promise<void> | null = null;

/**
 * Bring every stale stream up to its source. Cheap when nothing moved: one
 * conditional request per stream per minute, and GitHub doesn't count a 304
 * against the rate limit. Concurrent callers share one sync. Never throws.
 *
 * Needs a token: 48 streams would spend an anonymous client's hourly 60
 * requests in one pass, so without one the site serves the baseline.
 */
export function syncCorpus(): Promise<void> {
  if (pinned() || !token()) return Promise.resolve();
  inflight ??= (async () => {
    const now = Date.now();
    const stale = SOURCES.filter((s) => now - state.get(s.slug)!.checked >= TTL);
    const results = await Promise.allSettled(stale.map((s) => syncStream(s, state.get(s.slug)!)));
    let changed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") changed += r.value ? 1 : 0;
      else {
        // Back off for a TTL rather than retrying a broken stream on every render.
        state.get(stale[i].slug)!.checked = Date.now();
        console.warn(`[corpus] ${stale[i].slug}: ${(r.reason as Error).message}`);
      }
    });
    if (changed) {
      version++;
      console.log(`[corpus] ${changed} of ${stale.length} checked streams changed`);
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
