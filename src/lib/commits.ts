/**
 * Weekly commit volume, joined to the stream tree.
 *
 * Synced by scripts/sync-commits.mjs from /stats/contributors, which returns
 * weekly buckets across a repo's whole history with additions and deletions.
 *
 * IMPORTANT LIMITATION — stats are per REPO, changelogs are per PATH.
 * memopop-ai, memopop-native, and memopop-site are three streams reading one
 * repository at three different paths, so they necessarily share a commit
 * series: GitHub cannot attribute a commit to a subdirectory here. Global
 * totals therefore aggregate over UNIQUE REPOS, never over streams, or the
 * memopop trio would be counted three times.
 */
import data from "../stream/_commits.json";
import { getStreams, type Stream } from "./streams";

export interface Week {
  /** Unix seconds, GitHub's week start (Sunday). */
  w: number;
  commits: number;
  additions: number;
  deletions: number;
}

export interface RepoStats {
  commits: number;
  additions: number;
  deletions: number;
  weeks: Week[];
}

type Raw = { repos: Record<string, { commits: number; additions: number; deletions: number; weeks: number[][] }> };

const raw = (data as Raw).repos ?? {};

const byRepo = new Map<string, RepoStats>(
  Object.entries(raw).map(([repo, r]) => [
    repo,
    {
      commits: r.commits,
      additions: r.additions,
      deletions: r.deletions,
      weeks: r.weeks.map(([w, c, a, d]) => ({ w, commits: c, additions: a, deletions: d })),
    },
  ]),
);

export const statsForRepo = (repo: string): RepoStats | undefined => byRepo.get(repo);

/** Merge several weekly series into one, summing by week. */
export function mergeWeeks(series: Week[][]): Week[] {
  const acc = new Map<number, Week>();
  for (const s of series) {
    for (const wk of s) {
      const cur = acc.get(wk.w);
      if (cur) {
        cur.commits += wk.commits;
        cur.additions += wk.additions;
        cur.deletions += wk.deletions;
      } else {
        acc.set(wk.w, { ...wk });
      }
    }
  }
  return [...acc.values()].sort((a, b) => a.w - b.w);
}

/** Commit series for a stream's whole subtree, deduped by repo. */
export function statsForSubtree(root: Stream): { weeks: Week[]; commits: number; additions: number } {
  const seen = new Set<string>();
  const collect = (s: Stream) => {
    seen.add(s.repo);
    s.children.forEach(collect);
  };
  collect(root);
  const series = [...seen].map((r) => byRepo.get(r)?.weeks ?? []);
  const weeks = mergeWeeks(series);
  return {
    weeks,
    commits: weeks.reduce((n, w) => n + w.commits, 0),
    additions: weeks.reduce((n, w) => n + w.additions, 0),
  };
}

/** Every repo in the manifest, once. */
export const globalWeeks: Week[] = mergeWeeks(
  [...new Set(getStreams().map((s) => s.repo))].map((r) => byRepo.get(r)?.weeks ?? []),
);

export const globalTotals = {
  repos: new Set(getStreams().map((s) => s.repo)).size,
  commits: globalWeeks.reduce((n, w) => n + w.commits, 0),
  additions: globalWeeks.reduce((n, w) => n + w.additions, 0),
  deletions: globalWeeks.reduce((n, w) => n + w.deletions, 0),
  activeWeeks: globalWeeks.filter((w) => w.commits > 0).length,
};

/** GitHub's week key (Sunday start) for a date — used to align the two series. */
export function weekKeyOf(d: Date): number {
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return day / 1000 - ((d.getUTCDay() % 7) * 86_400);
}

/**
 * Weeks where code shipped but nothing was written down. This is the honest
 * measure of changelog discipline — not a gap at the start of the record, but
 * gaps distributed through it.
 */
export function silentWeeks(entryDates: (Date | null)[]): { weeks: number; commits: number } {
  const documented = new Set(entryDates.filter(Boolean).map((d) => weekKeyOf(d as Date)));
  const silent = globalWeeks.filter((w) => w.commits > 0 && !documented.has(w.w));
  return { weeks: silent.length, commits: silent.reduce((n, w) => n + w.commits, 0) };
}

/**
 * The y-scale every ledger strip is drawn against.
 *
 * Computed once from the whole corpus and passed down, for the same reason
 * `span` is: a project strip scaled to its own busiest day would make three
 * entries look like the fleet's record week.
 *
 * Clipped at the 95th percentile rather than the maximum. The busiest day
 * carries 27 entries against a median of 2, and 129 commits against a median
 * of 8 — scaling to those is what flattened everything else.
 *
 * Lives here rather than in lib/daily.ts to avoid an import cycle: daily.ts
 * reads streams, and the pages want both from one place.
 */
export function ledgerScale(
  entryDates: (Date | null)[],
  commitsPerDaySeries: number[],
): { entriesPerDay: number; commitsPerDay: number } {
  const perDay = new Map<number, number>();
  for (const d of entryDates) {
    if (!d) continue;
    const k = Math.floor(d.getTime() / 86_400_000);
    perDay.set(k, (perDay.get(k) ?? 0) + 1);
  }
  const p95 = (xs: number[]) => {
    if (!xs.length) return 1;
    const s = [...xs].sort((a, b) => a - b);
    return Math.max(1, s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]);
  };
  /**
   * Both clip at p95. At rest the strip should read as a normal time series —
   * a median day of 8 commits needs visible height, and scaling to the
   * 132-commit record squashed a whole year into a flat line with three spikes,
   * which made eighteen months of steady work look like nothing happened.
   *
   * The peaks are not lost, they are deferred: LedgerStrip draws a second,
   * UNCLIPPED series revealed on hover, where a 132-commit day runs to nearly
   * four times the frame height and out of the top. Rest reads the rhythm;
   * hover reads the outliers.
   */
  return {
    entriesPerDay: p95([...perDay.values()]),
    commitsPerDay: p95(commitsPerDaySeries.filter((n) => n > 0)),
  };
}
