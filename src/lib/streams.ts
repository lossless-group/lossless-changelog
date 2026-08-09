/**
 * Stream + entry loader.
 *
 * Reads the declared manifest (src/config/streams.yaml) and every synced entry
 * (src/stream/<slug>/*.md), joins them into a tree, and exposes the helpers the
 * pages need.
 *
 * Everything is resolved at build time via import.meta.glob, so the site is
 * fully static and never touches the network. Refreshing content is `pnpm sync`,
 * a deliberate step — see scripts/sync-streams.mjs.
 *
 * Parsing is LENIENT by design. The corpus spans ~30 repos and three years of
 * evolving convention: 12 entries have no `title`, one isn't date-named, and
 * the date lives under `date_created`, `date`, or nowhere at all. The job is to
 * surface what people actually wrote, not to gatekeep it.
 */
import matter from "gray-matter";
import manifestRaw from "../config/streams.yaml?raw";
import { parse as parseYaml } from "yaml";

export type Altitude = "fleet" | "product" | "component";

export interface StreamDef {
  slug: string;
  repo: string;
  ref: string;
  path: string;
  parent: string | null;
  shape: string;
  title: string;
  enabled?: boolean;
}

export interface Stream extends StreamDef {
  altitude: Altitude;
  depth: number;
  children: Stream[];
  ancestors: Stream[];
  ownCount: number;
  totalCount: number;
}

export interface Entry {
  slug: string;
  streamSlug: string;
  /** Canonical sort key. Filename prefix wins — it's the only near-universal field. */
  date: Date | null;
  dateLabel: string;
  title: string;
  lede?: string;
  tags: string[];
  authors: string[];
  body: string;
  sourceUrl: string;
}

// ── manifest ────────────────────────────────────────────────────────────────
const defs: StreamDef[] = (parseYaml(manifestRaw).streams as StreamDef[]).filter(
  (s) => s.enabled !== false,
);
const defBySlug = new Map(defs.map((d) => [d.slug, d]));

function ancestorsOf(slug: string): StreamDef[] {
  const out: StreamDef[] = [];
  let cur = defBySlug.get(slug)?.parent ?? null;
  // Guard against a manifest typo producing a cycle rather than hanging the build.
  const seen = new Set<string>([slug]);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const d = defBySlug.get(cur);
    if (!d) break;
    out.push(d);
    cur = d.parent;
  }
  return out;
}

const ALTITUDE: Altitude[] = ["fleet", "product", "component"];

// ── entries ─────────────────────────────────────────────────────────────────
const rawFiles = import.meta.glob<string>("../stream/**/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function coerceDate(v: unknown): Date | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

function labelFor(d: Date | null): string {
  if (!d) return "";
  return `${String(d.getUTCDate()).padStart(2, "0")} ${MONTHS[d.getUTCMonth()]}, ${d.getUTCFullYear()}`;
}

function asArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

/** Title fallback chain: frontmatter → first H1/H2 in the body → the slug. */
function titleFor(fm: Record<string, any>, body: string, slug: string): string {
  if (typeof fm.title === "string" && fm.title.trim()) return fm.title.trim();
  const h = body.match(/^#{1,2}\s+(.+)$/m);
  if (h) return h[1].trim();
  return slug;
}

const entries: Entry[] = [];

for (const [file, raw] of Object.entries(rawFiles)) {
  const m = file.match(/\/stream\/([^/]+)\/(.+)\.md$/);
  if (!m) continue;
  const [, streamSlug, entrySlug] = m;
  if (!defBySlug.has(streamSlug)) continue; // synced but no longer declared

  let fm: Record<string, any> = {};
  let body = raw;
  try {
    const parsed = matter(raw);
    fm = parsed.data ?? {};
    body = parsed.content;
  } catch {
    // Malformed YAML in one entry must not take down the build. Render it raw.
  }

  const fromName = entrySlug.match(DATE_RE);
  const date =
    (fromName ? new Date(`${fromName[1]}-${fromName[2]}-${fromName[3]}T00:00:00Z`) : null) ??
    coerceDate(fm.date_created) ??
    coerceDate(fm.date) ??
    coerceDate(fm.date_modified);

  entries.push({
    slug: entrySlug,
    streamSlug,
    date,
    dateLabel: labelFor(date),
    title: titleFor(fm, body, entrySlug),
    lede: (fm.lede ?? fm.summary ?? undefined) || undefined,
    tags: asArray(fm.tags),
    authors: asArray(fm.authors),
    body,
    sourceUrl: `https://github.com/${fm.from_repo}/blob/${fm.from_ref}/${
      defBySlug.get(streamSlug)?.path ?? ""
    }${fm.from_path ?? ""}`,
  });
}

/** Undated entries sink to the bottom rather than pretending to be epoch-old. */
function byDateDesc(a: Entry, b: Entry): number {
  if (!a.date && !b.date) return a.slug < b.slug ? 1 : -1;
  if (!a.date) return 1;
  if (!b.date) return -1;
  return b.date.getTime() - a.date.getTime();
}

entries.sort(byDateDesc);

const byStream = new Map<string, Entry[]>();
for (const e of entries) {
  if (!byStream.has(e.streamSlug)) byStream.set(e.streamSlug, []);
  byStream.get(e.streamSlug)!.push(e);
}

// ── tree ────────────────────────────────────────────────────────────────────
const streams = new Map<string, Stream>();

for (const d of defs) {
  const ancDefs = ancestorsOf(d.slug);
  streams.set(d.slug, {
    ...d,
    depth: ancDefs.length + 1,
    altitude: ALTITUDE[Math.min(ancDefs.length, ALTITUDE.length - 1)],
    children: [],
    ancestors: [],
    ownCount: byStream.get(d.slug)?.length ?? 0,
    totalCount: 0,
  });
}

for (const s of streams.values()) {
  s.ancestors = ancestorsOf(s.slug)
    .map((d) => streams.get(d.slug)!)
    .filter(Boolean)
    .reverse();
  if (s.parent && streams.has(s.parent)) streams.get(s.parent)!.children.push(s);
}

for (const s of streams.values()) {
  s.children.sort((a, b) => b.ownCount - a.ownCount || a.title.localeCompare(b.title));
  s.totalCount = descendantSlugs(s.slug).reduce(
    (n, slug) => n + (byStream.get(slug)?.length ?? 0),
    0,
  );
}

// ── public API ──────────────────────────────────────────────────────────────
export function descendantSlugs(slug: string): string[] {
  const s = streams.get(slug);
  if (!s) return [];
  return [slug, ...s.children.flatMap((c) => descendantSlugs(c.slug))];
}

export const getStreams = (): Stream[] => [...streams.values()];
export const getRoots = (): Stream[] =>
  getStreams()
    .filter((s) => !s.parent)
    .sort((a, b) => b.totalCount - a.totalCount);
export const getStream = (slug: string): Stream | undefined => streams.get(slug);
export const getEntries = (slug: string): Entry[] => byStream.get(slug) ?? [];

/** Every entry in this stream's subtree, merged newest-first. */
export function getSubtreeEntries(slug: string): Entry[] {
  return descendantSlugs(slug)
    .flatMap((s) => byStream.get(s) ?? [])
    .sort(byDateDesc);
}

export const getAllEntries = (): Entry[] => entries;

export function getEntry(streamSlug: string, entrySlug: string): Entry | undefined {
  return (byStream.get(streamSlug) ?? []).find((e) => e.slug === entrySlug);
}

export const totals = {
  streams: defs.length,
  entries: entries.length,
  roots: getRoots().length,
};
