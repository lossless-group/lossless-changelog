#!/usr/bin/env node
/**
 * Sync every declared changelog stream from the GitHub API into src/stream/.
 *
 *   pnpm sync              incremental — only streams whose ref moved
 *   pnpm sync --full       ignore cursors, refetch everything
 *   pnpm sync --dry-run    report what would change, write nothing
 *   pnpm sync --only=slug  one stream (repeatable: --only=a --only=b)
 *
 * Deliberate, not build-time. The splashes moved away from fetching during
 * `astro build` because it cost ~60 API calls per build and made CI flaky on
 * rate-limit or 5xx. This site's fanout is larger, so the same reasoning holds
 * harder: src/stream/ is committed, and `astro build` never touches the network.
 *
 * Auth: GITHUB_TOKEN or GITHUB_API_TOKEN. Anonymous works but is capped at
 * 60 req/hr, which a cold sync exceeds.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'src/config/streams.yaml');
const OUT_DIR = join(ROOT, 'src/stream');
const STATE_FILE = join(OUT_DIR, 'sync-state.json');

const TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || '';
const API = 'https://api.github.com';

const argv = process.argv.slice(2);
const FULL = argv.includes('--full');
const DRY = argv.includes('--dry-run');
const ONLY = argv.filter((a) => a.startsWith('--only=')).map((a) => a.slice(7));

// ── exclusion layer 2: path denylist ────────────────────────────────────────
// Layer 1 is the manifest allowlist itself. Layer 3 is the frontmatter guard
// below. These exist because a hand-edited manifest will eventually be wrong,
// and silent duplication of hundreds of entries is expensive to notice.
const DENY = [
  /(^|\/)splash\//,
  /(^|\/)dist\//,
  /(^|\/)node_modules\//,
  /(^|\/)generated-content\//,
  /(^|\/)changelog--/,
  /(^|\/)skills\//,
];

const isDenied = (p) => DENY.some((re) => re.test(p));

// ── exclusion layer 3: provenance guard ─────────────────────────────────────
// The rollup scripts inject `from:` / `from_path:` into every file they copy.
// Hand-written entries never carry them. Anything stamped is someone else's
// copy of an entry we either already have or deliberately excluded.
const ROLLUP_KEYS = /^(from|from_path):/m;

function frontmatterOf(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  return end === -1 ? null : text.slice(0, end + 4);
}

let apiCalls = 0;

async function gh(path, { etag } = {}) {
  const headers = { accept: 'application/vnd.github+json' };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  if (etag) headers['if-none-match'] = etag;
  apiCalls++;
  const res = await fetch(`${API}${path}`, { headers });
  if (res.status === 304) return { notModified: true, etag };
  if (res.status === 404) return { missing: true };
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = new Date(Number(res.headers.get('x-ratelimit-reset')) * 1000);
    throw new Error(`Rate limit exhausted. Resets ${reset.toISOString()}. Set GITHUB_TOKEN.`);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`);
  return { data: await res.json(), etag: res.headers.get('etag') };
}

/** Latest commit SHA touching this stream's path. One call; the cursor. */
async function headFor(stream, etag) {
  const p = stream.path ? `&path=${encodeURIComponent(stream.path)}` : '';
  const r = await gh(
    `/repos/${stream.repo}/commits?sha=${encodeURIComponent(stream.ref)}${p}&per_page=1`,
    { etag },
  );
  if (r.notModified) return { notModified: true };
  if (r.missing || !r.data?.length) return { sha: null, etag: r.etag };
  return { sha: r.data[0].sha, etag: r.etag };
}

async function listEntries(stream) {
  const dir = stream.path.replace(/\/$/, '');
  const r = await gh(`/repos/${stream.repo}/contents/${dir}?ref=${encodeURIComponent(stream.ref)}`);
  if (r.missing) throw new Error(`path not found: ${stream.repo}:${stream.ref}/${dir || '.'}`);

  // Shape assertion. dark-matter is why: matter-site/changelog is itself a
  // submodule, so this endpoint returns an object, not an array — and an
  // implementation that assumed an array would emit an empty stream silently.
  if (!Array.isArray(r.data)) {
    const kind = r.data?.type ?? 'unknown';
    const hint = r.data?.submodule_git_url ? ` → ${r.data.submodule_git_url}` : '';
    throw new Error(
      `${stream.slug}: expected a directory listing, got type="${kind}"${hint}. ` +
      `Declare the resolved repo directly and set shape: submodule-ref.`,
    );
  }
  return r.data.filter((f) => f.type === 'file' && f.name.endsWith('.md'));
}

async function syncStream(stream, state) {
  const prev = state[stream.slug] ?? {};
  const head = await headFor(stream, FULL ? undefined : prev.etag);

  if (!FULL && head.notModified) return { slug: stream.slug, status: 'unchanged', n: prev.count ?? 0 };
  if (!FULL && head.sha && head.sha === prev.sha) {
    return { slug: stream.slug, status: 'unchanged', n: prev.count ?? 0 };
  }

  const files = await listEntries(stream);
  const dest = join(OUT_DIR, stream.slug);
  const written = [];
  let skipped = 0;

  for (const f of files) {
    if (isDenied(f.path)) { skipped++; continue; }

    const raw = await fetch(f.download_url).then((r) => r.text());
    apiCalls++;

    const fm = frontmatterOf(raw);
    if (fm && ROLLUP_KEYS.test(fm)) { skipped++; continue; }

    // Provenance, mirroring the rollup convention. A pleasing consequence:
    // this site's own output is stamped, so it can never be re-ingested.
    const body = raw.startsWith('---')
      ? raw.replace(
          /^---\n/,
          `---\nfrom: ${stream.slug}\nfrom_path: ${f.name}\nfrom_repo: ${stream.repo}\nfrom_ref: ${stream.ref}\nfrom_sha: ${f.sha}\n`,
        )
      : `---\nfrom: ${stream.slug}\nfrom_path: ${f.name}\nfrom_repo: ${stream.repo}\nfrom_ref: ${stream.ref}\nfrom_sha: ${f.sha}\n---\n\n${raw}`;

    written.push({ name: f.name, body });
  }

  if (!DRY) {
    // Rewrite the directory so upstream deletions propagate. The aggregate
    // reflects what the source says now, not what it once said.
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    for (const w of written) writeFileSync(join(dest, w.name), w.body);
    state[stream.slug] = {
      sha: head.sha, etag: head.etag, count: written.length,
      repo: stream.repo, ref: stream.ref, path: stream.path,
    };
  }

  const before = existsSync(dest) ? readdirSync(dest).filter((f) => f.endsWith('.md')).length : 0;
  return { slug: stream.slug, status: 'synced', n: written.length, delta: written.length - before, skipped };
}

// ── main ────────────────────────────────────────────────────────────────────
const manifest = parseYaml(readFileSync(MANIFEST, 'utf8'));
let streams = manifest.streams.filter((s) => s.enabled !== false);
if (ONLY.length) streams = streams.filter((s) => ONLY.includes(s.slug));

// Cursors key on STREAM, not repo — memopop-ai, memopop-native, and
// memopop-site all read one repo at three paths. A shared cursor would let the
// first sync mark the others' commits as already-seen.
mkdirSync(OUT_DIR, { recursive: true });
const state = !FULL && existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {};

if (!TOKEN) console.warn('! No GITHUB_TOKEN — anonymous access is capped at 60 req/hr.\n');
console.log(`Syncing ${streams.length} streams${FULL ? ' (full)' : ''}${DRY ? ' (dry run)' : ''}…\n`);

const results = [];
const failures = [];
for (const s of streams) {
  try {
    results.push(await syncStream(s, state));
  } catch (err) {
    failures.push({ slug: s.slug, message: err.message });
    // Keep going. One bad stream must not abandon the other 37, and the
    // existing src/stream/<slug>/ stays intact so the site still builds.
  }
}

for (const r of results.sort((a, b) => b.n - a.n)) {
  if (r.status === 'unchanged') continue;
  const d = r.delta > 0 ? ` (+${r.delta})` : r.delta < 0 ? ` (${r.delta})` : '';
  const sk = r.skipped ? `  [${r.skipped} excluded]` : '';
  console.log(`  ${String(r.n).padStart(4)}  ${r.slug}${d}${sk}`);
}

const unchanged = results.filter((r) => r.status === 'unchanged').length;
const total = results.reduce((a, r) => a + r.n, 0);
console.log(`\n${total} entries · ${results.length - unchanged} synced · ${unchanged} unchanged · ${apiCalls} API calls`);

if (failures.length) {
  console.error(`\n${failures.length} stream(s) FAILED:`);
  for (const f of failures) console.error(`  ${f.slug}: ${f.message}`);
}

if (!DRY) writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
process.exit(failures.length ? 1 : 0);
