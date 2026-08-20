/**
 * What KIND of line, not just how many.
 *
 * The chart used to say "5.9M lines" and mean it as a code metric. It was not
 * one. GitHub's /stats/contributors — the only series behind _commits.json —
 * reports weekly additions per repo with no path attribution at all, so every
 * line ever committed landed in a single undifferentiated pile. In this tree
 * that misreads the work badly: astro-knots holds 71k lines of context-v
 * against 13k of code, lossless-ai-labs 166k against 38k, and lossless-content
 * is a prose corpus with no code in it whatsoever. Documentation is the
 * majority of what gets written here and the headline was crediting it to the
 * compiler.
 *
 * ── The hybrid ──
 *
 * Two sources, each doing the thing it is good at:
 *
 *   _commits.json  GitHub's per-repo additions. Stays the DENOMINATOR, so the
 *                  site's published totals remain continuous with what it has
 *                  claimed all along.
 *   _lines.json    Local `git log --numstat`, split by path. Supplies the
 *                  RATIOS — how that total divides into code / context-v /
 *                  changelog / content.
 *
 * They disagree, and not by a little: GitHub credits astro-knots with 158k
 * additions where the repo (verified in sync with origin) carries 122k. We do
 * not try to reconcile them. GitHub's cached figure decides how big the pie
 * is; the local history decides how it is sliced.
 *
 * So every number below is an ESTIMATE with an exact shape — the proportions
 * are measured from real history, the magnitudes are inherited from GitHub.
 *
 * ── What is dropped ──
 *
 * Lockfiles and vendored trees are excluded outright: nobody authored them.
 * This is not a rounding detail. node_modules/ is committed in this very repo
 * (10,809 files, tracked since the initial commit despite .gitignore line 1)
 * and accounts for 998k of its 1.08M local lines. Dropping it before scaling
 * is the difference between claiming 2.1M lines here and the ~148k that were
 * actually written.
 */
import commitData from "../stream/_commits.json";
import lineData from "../stream/_lines.json";
import { getStreams, type Stream } from "./streams";

/** The four buckets we attribute. Order is display order. */
export const LINE_KINDS = ["code", "contextv", "changelog", "content"] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export interface LineSplit extends Record<LineKind, number> {
  /** Sum of the four attributed buckets. */
  total: number;
  /** Additions we could not split — a repo with no local clone. Reported, never attributed. */
  unsplit: number;
}

type RawLines = {
  repos: Record<string, {
    local: number; code: number; contextv: number; changelog: number;
    content: number; lock: number; vendored: number;
  }>;
};
type RawCommits = { repos: Record<string, { additions: number }> };

const localByRepo = (lineData as RawLines).repos ?? {};
const githubByRepo = (commitData as RawCommits).repos ?? {};

/**
 * NO SCALING. Line counts are the ones we measured.
 *
 * This used to apportion GitHub's per-repo `additions` across the local
 * path-split — GitHub set the magnitude, local history set the proportions.
 * The reason was continuity: the site had published "5.9M lines" and a smaller
 * number would have looked like a regression.
 *
 * That justification did not survive. The 5.9M was itself inflated by a
 * committed node_modules that has since been removed from history, the headline
 * has moved several times regardless, and the scaling was adding 45% on top of
 * the measured figures — 1.96M of real code was being published as 2.95M.
 * It also produced an outright failure once: rewriting this repo's history sent
 * its factor to 26.7x and the fleet code total to 4.7M in a single rebuild,
 * which needed a clamp to contain.
 *
 * Every number below is now something we counted with `git log --numstat`.
 * Smaller, stable, and defensible line by line — and immune to GitHub's stats
 * cache drifting underneath us.
 *
 * `_commits.json` is still the source for COMMIT counts and the weekly series;
 * only the line apportionment is gone.
 */

const empty = (): LineSplit =>
  ({ code: 0, contextv: 0, changelog: 0, content: 0, total: 0, unsplit: 0 });

/**
 * One repo's additions, split by kind and rescaled onto GitHub's total.
 *
 * The scale factor deliberately uses the repo's FULL local total as its
 * denominator, vendored lines included, before those lines are discarded.
 * GitHub counted node_modules too, so it has to be in the denominator for the
 * ratio to mean anything — otherwise dropping 998k vendored lines from this
 * repo would just redistribute them into `code` at twice the weight.
 */
function splitRepo(repo: string): LineSplit {
  const out = empty();
  const local = localByRepo[repo];

  if (!local) {
    // No clone to read. Rather than guess at a shape, hold the total aside.
    out.unsplit = githubByRepo[repo]?.additions ?? 0;
    return out;
  }

  for (const kind of LINE_KINDS) out[kind] = local[kind];
  out.total = LINE_KINDS.reduce((n, k) => n + out[k], 0);
  return out;
}

const splitCache = new Map<string, LineSplit>();
export function linesForRepo(repo: string): LineSplit {
  let s = splitCache.get(repo);
  if (!s) { s = splitRepo(repo); splitCache.set(repo, s); }
  return s;
}

/** Sum several repos' splits. Deduped by caller — repos, never streams. */
export function linesForRepos(repos: Iterable<string>): LineSplit {
  const out = empty();
  for (const repo of new Set(repos)) {
    const s = linesForRepo(repo);
    for (const k of LINE_KINDS) out[k] += s[k];
    out.total += s.total;
    out.unsplit += s.unsplit;
  }
  return out;
}

/**
 * A stream subtree's lines, deduped by repo — the memopop trio reads one
 * repository at three paths and must not be counted three times.
 */
export function linesForSubtree(root: Stream): LineSplit {
  const seen = new Set<string>();
  const collect = (s: Stream) => { seen.add(s.repo); s.children.forEach(collect); };
  collect(root);
  return linesForRepos(seen);
}

export const globalLines: LineSplit = linesForRepos(getStreams().map((s) => s.repo));

/** Everything that isn't code — the number the old headline was hiding. */
export const proseLines = (l: LineSplit) => l.contextv + l.changelog + l.content;

export const LINE_LABELS: Record<LineKind, string> = {
  code: "Code",
  contextv: "Context",
  changelog: "Changelog",
  content: "Content",
};
