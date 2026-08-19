/**
 * The four buckets the changelog filters by.
 *
 * These are tree roots, not an invented taxonomy: ai-labs, astro-knots and
 * content-farm are the three pseudomonorepos that hold most of the work, and
 * everything else — the standalone repos that never got a parent — collects
 * into Misc rather than being dropped or given a root each. Four controls is
 * a filter; eleven is a second navigation.
 */
import { getStreams, ancestorsOf, type Entry } from "./streams";
import iconData from "../stream/_icons.json";

export interface Group {
  id: string;
  title: string;
  /** Root slug this group maps to, or null for the catch-all. */
  root: string | null;
  icon?: string;
}

const icons = (iconData as { icons: Record<string, string> }).icons ?? {};

export const GROUPS: Group[] = [
  { id: "ai-labs", title: "AI Labs", root: "ai-labs", icon: icons["ai-labs"] },
  { id: "astro-knots", title: "Astro Knots", root: "astro-knots", icon: icons["astro-knots"] },
  { id: "content-farm", title: "Content Farm", root: "content-farm", icon: icons["content-farm"] },
  { id: "misc", title: "Misc", root: null },
];

const NAMED = new Set(GROUPS.map((g) => g.root).filter(Boolean) as string[]);

/** The root a stream ultimately hangs from — itself, if it is one. */
const rootCache = new Map<string, string>();
function rootOf(slug: string): string {
  let r = rootCache.get(slug);
  if (r) return r;
  const chain = ancestorsOf(slug);
  r = chain.length ? chain[chain.length - 1].slug : slug;
  rootCache.set(slug, r);
  return r;
}

/** Which filter bucket a stream belongs to. */
export function groupOf(streamSlug: string): string {
  const root = rootOf(streamSlug);
  return NAMED.has(root) ? root : "misc";
}

export const groupOfEntry = (e: Entry) => groupOf(e.streamSlug);

/** Entry counts per group, for the filter labels. */
export function groupCounts(entries: Entry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of GROUPS) out[g.id] = 0;
  for (const e of entries) out[groupOf(e.streamSlug)] += 1;
  return out;
}

/** Per-project icons, for the ledger rows. */
export const iconFor = (slug: string): string | undefined => icons[slug];

/** Streams with no icon of their own fall back to their group's mark. */
export function iconOrGroup(slug: string): string | undefined {
  return icons[slug] ?? GROUPS.find((g) => g.id === groupOf(slug))?.icon;
}

export const allStreamSlugs = () => getStreams().map((s) => s.slug);
