/**
 * Per-day commits and authored lines, from local git history.
 *
 * Why this exists rather than reusing lib/commits.ts: GitHub's
 * /stats/contributors only buckets by WEEK, and a week is the wrong unit for
 * this record. The median active day carries 8 commits and the busiest carries
 * 129 — averaged into a week, the difference between a normal Tuesday and a
 * day given over entirely to the work disappears. That difference is the
 * story: one operator who is not primarily a developer, and output that
 * concentrates into a handful of days a month.
 *
 * Keyed by repo, merged at read time, so a project row is drawn in the same
 * unit as the global strip. Synced by scripts/sync-line-classes.mjs, which
 * already drops lockfiles and vendored trees — a day cannot look productive
 * because a lockfile churned.
 */
import data from "../stream/_daily.json";
import { getStreams, type Stream } from "./streams";

export interface Day {
  date: Date;
  /** Unix ms at UTC midnight — the merge key. */
  t: number;
  commits: number;
  code: number;
  contextv: number;
  changelog: number;
  content: number;
  /** Authored lines of every kind. */
  lines: number;
}

type Row = [number, number, number, number, number];
type Raw = { repos: Record<string, Record<string, Row>> };

const raw = (data as unknown as Raw).repos ?? {};

/** Merge several repos' day series into one, summing by day. */
export function dailyForRepos(repos: Iterable<string>): Day[] {
  const acc = new Map<string, Row>();
  for (const repo of new Set(repos)) {
    const series = raw[repo];
    if (!series) continue;
    for (const [d, row] of Object.entries(series)) {
      const cur = acc.get(d);
      if (cur) for (let i = 0; i < 5; i++) cur[i] += row[i];
      else acc.set(d, [...row] as Row);
    }
  }
  return [...acc.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([d, [commits, code, contextv, changelog, content]]) => {
      const date = new Date(`${d}T00:00:00Z`);
      return {
        date, t: date.getTime(), commits, code, contextv, changelog, content,
        lines: code + contextv + changelog + content,
      };
    });
}

/** A stream subtree's days, deduped by repo — never counted twice. */
export function dailyForSubtree(root: Stream): Day[] {
  const seen = new Set<string>();
  const collect = (s: Stream) => { seen.add(s.repo); s.children.forEach(collect); };
  collect(root);
  return dailyForRepos(seen);
}

export const days: Day[] = dailyForRepos(getStreams().map((s) => s.repo));

/**
 * Days given over to the work. At more than ten commits you are not dipping in
 * between other things.
 */
export const FOCUS_THRESHOLD = 10;
export const focusDays: Day[] = days.filter((d) => d.commits > FOCUS_THRESHOLD);

const allCommits = days.reduce((n, d) => n + d.commits, 0);

export const focusTotals = {
  days: focusDays.length,
  activeDays: days.length,
  commits: focusDays.reduce((n, d) => n + d.commits, 0),
  lines: focusDays.reduce((n, d) => n + d.lines, 0),
  busiest: days.reduce<Day | null>((m, d) => (!m || d.commits > m.commits ? d : m), null),
  /** Share of all commits that landed on a focus day. */
  commitShare: allCommits
    ? Math.round((days.filter((d) => d.commits > FOCUS_THRESHOLD)
        .reduce((n, d) => n + d.commits, 0) / allCommits) * 100)
    : 0,
};
