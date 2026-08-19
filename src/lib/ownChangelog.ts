/**
 * This site's OWN changelog — `changelog/` at the repo root.
 *
 * Distinct from everything in lib/streams.ts, which loads the *aggregate*:
 * entries mirrored from thirty-odd other repositories into `src/stream/`.
 * Those are someone else's record and carry `from:` provenance stamps. These
 * two are ours, written here, and were never rendered anywhere — the site that
 * publishes everyone's ship log had no surface for its own.
 *
 * Kept deliberately separate rather than declared as a stream in
 * streams.yaml: the aggregation spec's whole discipline is "never ingest a
 * rollup", and a site ingesting itself is the purest case of that. Enforced by
 * sync-streams.mjs too, which stamps its output so it can never be re-read.
 */
import matter from "gray-matter";

export interface OwnEntry {
  /** URL segment — the filename without extension, e.g. `2026-08-09_01`. */
  slug: string;
  date: Date | null;
  dateLabel: string;
  title: string;
  lede?: string;
  tags: string[];
  authors: string[];
  augmentedWith: string[];
  body: string;
}

const files = import.meta.glob("../../changelog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String).filter(Boolean) : v ? [String(v)] : [];

/**
 * The filename prefix is the sort key, matching lib/streams.ts. It is the one
 * field the changelog convention makes near-universal, and it survives
 * frontmatter drift across three years of evolving practice.
 */
function dateFrom(name: string, fm: Record<string, any>): Date | null {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})/);
  const raw = m?.[1] ?? fm.date_created ?? fm.date ?? fm.date_authored_initial_draft;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const ownEntries: OwnEntry[] = Object.entries(files)
  .map(([path, raw]) => {
    const name = path.split("/").pop()!.replace(/\.md$/, "");
    const { data: fm, content } = matter(raw);
    const date = dateFrom(name, fm);
    return {
      slug: name,
      date,
      dateLabel: date
        ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
        : "",
      title: String(fm.title ?? name),
      lede: fm.lede ? String(fm.lede) : undefined,
      tags: asList(fm.tags),
      authors: asList(fm.authors),
      augmentedWith: asList(fm.augmented_with),
      body: content,
    };
  })
  // `publish: false` is the convention's own opt-out; respect it.
  .filter((e) => matter(files[`../../changelog/${e.slug}.md`]).data.publish !== false)
  .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

export const getOwnEntry = (slug: string) => ownEntries.find((e) => e.slug === slug);
