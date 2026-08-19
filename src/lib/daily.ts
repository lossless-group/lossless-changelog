/**
 * Per-day commits and authored lines, from local git history.
 *
 * Why this exists separately from lib/commits.ts: GitHub's /stats/contributors
 * only buckets by week, and a week is the wrong unit for this record. The
 * median active day carries 8 commits and the busiest carries 129 — averaged
 * into a week, the difference between a normal Tuesday and a day of total
 * focus disappears. That difference is the story: one operator who is not
 * primarily a developer, and the output concentrated in the days that were
 * given over to it entirely.
 *
 * Synced by scripts/sync-line-classes.mjs. Lockfiles and vendored trees are
 * already excluded upstream, so a day cannot look productive because a
 * lockfile churned.
 */
import data from "../stream/_daily.json";

export interface Day {
  date: Date;
  commits: number;
  code: number;
  contextv: number;
  changelog: number;
  content: number;
  /** Authored lines of every kind. */
  lines: number;
}

// The JSON import widens the fixed-length tuple to number[], so go via
// unknown rather than loosening the shape this file actually relies on.
type Raw = { days: Record<string, [number, number, number, number, number]> };

export const days: Day[] = Object.entries((data as unknown as Raw).days ?? {})
  .map(([d, [commits, code, contextv, changelog, content]]) => ({
    date: new Date(`${d}T00:00:00Z`),
    commits, code, contextv, changelog, content,
    lines: code + contextv + changelog + content,
  }))
  .sort((a, b) => a.date.getTime() - b.date.getTime());

/**
 * Days given over to the work. The threshold is deliberately low-ish: at more
 * than ten commits a day you are not dipping in between other things.
 */
export const FOCUS_THRESHOLD = 10;
export const focusDays: Day[] = days.filter((d) => d.commits > FOCUS_THRESHOLD);

export const focusTotals = {
  days: focusDays.length,
  activeDays: days.length,
  commits: focusDays.reduce((n, d) => n + d.commits, 0),
  lines: focusDays.reduce((n, d) => n + d.lines, 0),
  busiest: days.reduce<Day | null>((m, d) => (!m || d.commits > m.commits ? d : m), null),
  /** Share of all commits that landed on a focus day. */
  get commitShare() {
    const all = days.reduce((n, d) => n + d.commits, 0);
    return all ? Math.round((this.commits / all) * 100) : 0;
  },
};
