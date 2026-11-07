/**
 * activity.ts — commit and line activity, kept current between syncs.
 *
 * The baseline is what the sync scripts wrote: `_commits.json` (GitHub's
 * weekly series), `_lines.json` and `_daily.json` (local `git log --numstat`,
 * split by kind), and `_heads.json`, the branch head each repo was at when
 * they ran. Those scans need clones and run from a laptop; a server can't
 * repeat them.
 *
 * What a server can do is ask GitHub for the commits made SINCE that head.
 * `syncActivity()` checks each repo's branch (one conditional request, free
 * when nothing moved), compares the recorded head with the current one, reads
 * each new commit's files, and folds them into the same three shapes with the
 * same classifier sync-line-classes.mjs uses. The pages read the merged
 * result through lib/commits.ts, lib/daily.ts and lib/lines.ts, so the
 * headline, the strip and the stats area all move on a push.
 *
 * Re-running the sync scripts resets the cursor and shrinks the overlay to
 * nothing; it is never required for freshness. Never throws into a page.
 */
import commitsBase from "../stream/_commits.json";
import linesBase from "../stream/_lines.json";
import dailyBase from "../stream/_daily.json";
import headsBase from "../stream/_heads.json";
import manifestRaw from "../config/streams.yaml?raw";
import { parse as parseYaml } from "yaml";

type CommitsRaw = { repos: Record<string, { commits: number; additions: number; deletions: number; weeks: number[][] }> };
type LinesRaw = { repos: Record<string, Record<string, number>> };
type DailyRaw = { repos: Record<string, Record<string, number[]>> };
type HeadsRaw = { repos: Record<string, { ref: string; sha: string }> };

interface ManifestStream {
  repo: string;
  ref: string;
  kind?: string;
  enabled?: boolean;
  /** stats_only: path prefixes dropped like roll-ups. */
  exclude?: string[];
}

const manifest = parseYaml(manifestRaw);
// Streams plus the stats-only repos (see streams.yaml): both count toward the totals.
const active: ManifestStream[] = [
  ...(manifest.streams as ManifestStream[]).filter((s) => s.enabled !== false),
  ...((manifest.stats_only ?? []) as ManifestStream[]),
];

/** Each repo once, on the branch its first stream reads — the branch the relay watches. */
const REPOS = new Map<string, string>();
for (const s of active) if (!REPOS.has(s.repo)) REPOS.set(s.repo, s.ref);

/** Whether a push to this repo and ref (`refs/heads/x`) moves the totals. */
export function countsPush(repo: string, ref?: string): boolean {
  const r = [...REPOS].find(([k]) => k.toLowerCase() === repo.toLowerCase());
  return !!r && (!ref || ref === `refs/heads/${r[1]}`);
}

/** Every counted repo, once: what the fleet-wide totals sum over. */
export const COUNTED_REPOS = [...REPOS.keys()];

const excludesOf = new Map(active.filter((s) => s.exclude).map((s) => [s.repo.toLowerCase(), s.exclude!]));

const contentRepos = new Set(active.filter((s) => s.kind === "content").map((s) => s.repo.toLowerCase()));
const contextRepos = new Set(active.filter((s) => s.kind === "context").map((s) => s.repo.toLowerCase()));

const env = (k: string): string | undefined => (import.meta.env as any)[k] ?? process.env[k];
const token = () => env("GITHUB_TOKEN") ?? env("GITHUB_API_TOKEN");
const pinned = () => env("CONTENT_SOURCE") === "baseline";

/* ------------------------------------------- sync-line-classes.mjs, mirrored -- */

// Keep in step with scripts/sync-line-classes.mjs.
const LOCK = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|Cargo\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
const ROLLUP = /(^|\/)src\/(rollup|stream)\//;
const VENDORED = /(^|\/)(node_modules|dist|build|vendor|reports|\.astro|\.next|\.svelte-kit)\//;
const CONTEXTV = /(^|\/)context-v\//;
const CHANGELOG = /(^|\/)changelogs?(--[a-z0-9-]+)?\//i;

type Kind = "code" | "contextv" | "changelog" | "content" | "lock" | "vendored" | "rollup";

function classify(path: string, repo: string): Kind {
  if ((excludesOf.get(repo.toLowerCase()) ?? []).some((p) => path.startsWith(p))) return "rollup";
  if (LOCK.test(path)) return "lock";
  if (ROLLUP.test(path)) return "rollup";
  if (VENDORED.test(path)) return "vendored";
  if (CONTEXTV.test(path)) return "contextv";
  if (CHANGELOG.test(path)) return "changelog";
  if (contextRepos.has(repo.toLowerCase())) return "contextv";
  return contentRepos.has(repo.toLowerCase()) ? "content" : "code";
}

/** GitHub's week key (Sunday start), in unix seconds. Same as lib/commits.ts. */
function weekKey(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  return d.getTime() / 1000 - d.getUTCDay() * 86_400;
}

/* ----------------------------------------------------------------- GitHub -- */

let inFlight = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= 8) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

function gh(path: string, etag?: string) {
  return limited(() => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "lossless-changelog",
    };
    const t = token();
    if (t) headers.Authorization = `Bearer ${t}`;
    if (etag) headers["If-None-Match"] = etag;
    return fetch(`https://api.github.com${path}`, { headers, signal: AbortSignal.timeout(15_000) });
  });
}

interface CommitDelta {
  day: string;
  additions: number;
  deletions: number;
  kinds: Record<Kind, number>;
}

const details = new Map<string, Promise<CommitDelta | null>>();
/** One commit's dated, classified line counts. Memoized by sha; merges are skipped. */
function commitDelta(repo: string, sha: string): Promise<CommitDelta | null> {
  const key = `${repo}@${sha}`;
  if (!details.has(key)) {
    details.set(
      key,
      (async () => {
        const res = await gh(`/repos/${repo}/commits/${sha}`);
        if (!res.ok) throw new Error(`GitHub ${res.status} reading commit ${sha.slice(0, 7)}`);
        const c = await res.json();
        if ((c.parents?.length ?? 0) > 1) return null; // --no-merges
        // A commit that only touched `exclude:` paths is another repo's work.
        const files = (c.files ?? []) as { filename: string }[];
        const ex = excludesOf.get(repo.toLowerCase());
        if (ex && files.length && files.every((f) => ex.some((p) => f.filename.startsWith(p)))) return null;
        const kinds = { code: 0, contextv: 0, changelog: 0, content: 0, lock: 0, vendored: 0, rollup: 0 };
        for (const f of c.files ?? []) kinds[classify(f.filename, repo)] += f.additions ?? 0;
        return {
          day: String(c.commit?.committer?.date ?? "").slice(0, 10),
          additions: c.stats?.additions ?? 0,
          deletions: c.stats?.deletions ?? 0,
          kinds,
        };
      })().catch((e) => {
        details.delete(key);
        throw e;
      }),
    );
  }
  return details.get(key)!;
}

/* ------------------------------------------------------------------ state -- */

interface RepoState {
  ref: string;
  /** The head the baseline was scanned at. Commits after it are the overlay. */
  base?: string;
  /** The head the current overlay reflects. */
  head?: string;
  etag?: string;
  checked: number;
  deltas: CommitDelta[];
}

const heads = (headsBase as HeadsRaw).repos ?? {};
const state = new Map<string, RepoState>(
  [...REPOS].map(([repo, ref]) => {
    const h = heads[repo];
    return [repo, { ref, base: h?.ref === ref ? h.sha : undefined, head: undefined, checked: 0, deltas: [] }];
  }),
);

let version = 0;
export const activityVersion = () => version;

/** Make the next sync re-check these repos at once. Called by the hook. */
export function forgetRepos(repos: string[]) {
  for (const r of repos) {
    const st = [...state].find(([k]) => k.toLowerCase() === r.toLowerCase())?.[1];
    if (st) st.checked = 0;
  }
}

const TTL = 60_000;

async function syncRepo(repo: string, st: RepoState): Promise<boolean> {
  // No recorded base: nothing to diff against until the next stats sync.
  if (!st.base) {
    st.checked = Date.now();
    return false;
  }
  const res = await gh(`/repos/${repo}/commits/${encodeURIComponent(st.ref)}`, st.etag);
  if (res.status === 304) {
    st.checked = Date.now();
    return false;
  }
  if (!res.ok) throw new Error(`GitHub ${res.status} resolving ${repo}@${st.ref}`);
  const sha = (await res.json()).sha as string;
  const etag = res.headers.get("etag") ?? undefined;

  if (sha === st.head || (sha === st.base && !st.deltas.length)) {
    st.head = sha;
    st.etag = etag;
    st.checked = Date.now();
    return false;
  }

  let deltas: CommitDelta[] = [];
  if (sha !== st.base) {
    // `commits` here are the ones reachable from the head and not from the
    // base, even when history diverged — exactly the work done since the scan.
    const cmp = await gh(`/repos/${repo}/compare/${st.base}...${sha}`);
    if (!cmp.ok) throw new Error(`GitHub ${cmp.status} comparing ${repo}`);
    const commits = ((await cmp.json()).commits ?? []) as { sha: string }[];
    deltas = (await Promise.all(commits.map((c) => commitDelta(repo, c.sha)))).filter(
      (d): d is CommitDelta => !!d && !!d.day,
    );
  }

  st.deltas = deltas;
  st.head = sha;
  st.etag = etag;
  st.checked = Date.now();
  return true;
}

let inflight: Promise<void> | null = null;

/** Bring every stale repo's overlay up to its branch head. Never throws. */
export function syncActivity(): Promise<void> {
  if (pinned() || !token()) return Promise.resolve();
  inflight ??= (async () => {
    const now = Date.now();
    const stale = [...state].filter(([, st]) => now - st.checked >= TTL);
    const results = await Promise.allSettled(stale.map(([repo, st]) => syncRepo(repo, st)));
    let changed = 0;
    results.forEach((r, i) => {
      if (r.status === "fulfilled") changed += r.value ? 1 : 0;
      else {
        stale[i][1].checked = Date.now();
        console.warn(`[activity] ${stale[i][0]}: ${(r.reason as Error).message}`);
      }
    });
    if (changed) {
      version++;
      merged = null;
      console.log(`[activity] ${changed} of ${stale.length} checked repos moved`);
    }
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/* ----------------------------------------------------------------- merged -- */

interface Merged {
  commits: CommitsRaw;
  lines: LinesRaw;
  daily: DailyRaw;
}

let merged: Merged | null = null;

/** Baseline plus every repo's overlay, in the sync scripts' own shapes. */
function build(): Merged {
  const commits: CommitsRaw = structuredClone(commitsBase as CommitsRaw);
  const lines: LinesRaw = structuredClone(linesBase as LinesRaw);
  const daily: DailyRaw = structuredClone(dailyBase as unknown as DailyRaw);
  commits.repos ??= {};
  lines.repos ??= {};
  daily.repos ??= {};

  for (const [repo, st] of state) {
    if (!st.deltas.length) continue;
    const c = (commits.repos[repo] ??= { commits: 0, additions: 0, deletions: 0, weeks: [] });
    const weeks = new Map(c.weeks.map((w) => [w[0], [...w]]));
    const l = (lines.repos[repo] ??= { local: 0, code: 0, contextv: 0, changelog: 0, content: 0, lock: 0, vendored: 0, rollup: 0 });
    const d = (daily.repos[repo] ??= {});

    for (const x of st.deltas) {
      c.commits += 1;
      c.additions += x.additions;
      c.deletions += x.deletions;
      const wk = weekKey(x.day);
      const w = weeks.get(wk) ?? [wk, 0, 0, 0];
      w[1] += 1;
      w[2] += x.additions;
      w[3] += x.deletions;
      weeks.set(wk, w);

      for (const [k, n] of Object.entries(x.kinds)) {
        l[k] = (l[k] ?? 0) + n;
        l.local += n;
      }
      const row = (d[x.day] ??= [0, 0, 0, 0, 0]);
      row[0] += 1;
      row[1] += x.kinds.code;
      row[2] += x.kinds.contextv;
      row[3] += x.kinds.changelog;
      row[4] += x.kinds.content;
    }
    c.weeks = [...weeks.values()].sort((a, b) => a[0] - b[0]);
  }
  return { commits, lines, daily };
}

const current = () => (merged ??= build());
export const commitsData = () => current().commits;
export const linesData = () => current().lines;
export const dailyData = () => current().daily;
