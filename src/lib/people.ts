/**
 * People registry — resolves an author string from frontmatter to a person
 * record with a headshot.
 *
 * EXTRACTED from site/src/components/basics/AuthorHandle.astro, with two
 * substantive changes:
 *
 *   1. Data is imported at build time rather than read with `fs.readdir` at
 *      render time. The source walked `src/content/people/` on every component
 *      render, which works under SSR and is both slow and fragile for a static
 *      build of 392 pages.
 *
 *   2. Matching is TOKEN-based, not substring-based. The source compared with
 *      `a.includes(b) || b.includes(a)`, which fails on the most common real
 *      variant in this corpus: "Michael P. Staton" (8 entries) does not
 *      substring-match "Michael Staton" in either direction, so those entries
 *      would have silently rendered no author at all.
 */
import authorsJson from "../content/people/authors.json";
import participantsJson from "../content/people/participants.json";

/**
 * Headshots are imported through Astro's asset pipeline rather than served
 * from public/. The originals are wildly oversized for a 32px avatar — two
 * were 800x800 PNGs at 522KB and 703KB — and public/ files are copied to the
 * output byte-for-byte with no processing. Importing them lets sharp resize
 * and re-encode at build time.
 */
const headshotModules = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/people/*.{jpeg,jpg,png,webp}",
  { eager: true },
);

/** Keyed on the filename STEM (no extension) so a `headshotOf` value written
 *  as ".../staton_headshot.jpeg" still resolves after the source asset was
 *  re-encoded to .webp. Also makes the lookup independent of the directory the
 *  path was authored against. */
const stem = (p: string) => p.split("/").pop()!.replace(/\.[^.]+$/, "").toLowerCase();

const headshots = new Map<string, ImageMetadata>(
  Object.entries(headshotModules).map(([path, mod]) => [stem(path), mod.default]),
);

export interface Person {
  id: string;
  name: string;
  role?: string;
  bio?: string;
  headshotOf?: string;
  socialLinks?: Record<string, string | undefined>;
}

function collect(data: unknown): Person[] {
  if (Array.isArray(data)) return data as Person[];
  const d = data as Record<string, unknown>;
  for (const key of ["authors", "network-people", "participants", "people"]) {
    if (Array.isArray(d?.[key])) return d[key] as Person[];
  }
  return [];
}

const people: Person[] = [...collect(authorsJson), ...collect(participantsJson)];

/** Strip punctuation and middle initials down to comparable name tokens. */
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,''`]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 1); // drops "p" from "Michael P. Staton"
}

/** first+last token signature — stable across middle names and initials. */
function signature(name: string): string {
  const t = tokens(name);
  if (t.length === 0) return "";
  return t.length === 1 ? t[0] : `${t[0]} ${t[t.length - 1]}`;
}

const byId = new Map(people.map((p) => [p.id.toLowerCase(), p]));
const bySignature = new Map(people.map((p) => [signature(p.name), p]));

/**
 * `authors` frontmatter is supposed to be humans only (changelog-conventions),
 * but the corpus has AI tooling in that field on ~30 entries. These resolve to
 * no person, which is the correct outcome — they surface via `augmented_with`
 * instead. Listed here so the behavior is intentional rather than incidental.
 */
const NON_HUMAN = /^(claude|chatgpt|gpt|cursor|windsurf|copilot|pi|augment-it|.*\bteam\b)/i;

export function resolvePerson(author: string): Person | undefined {
  const raw = author?.trim();
  if (!raw || NON_HUMAN.test(raw)) return undefined;
  return byId.get(raw.toLowerCase()) ?? bySignature.get(signature(raw));
}

/** Split an author list into resolved people and unmatched leftover strings. */
export function partitionAuthors(authors: string[]): {
  people: Person[];
  unmatched: string[];
} {
  const seen = new Set<string>();
  const matched: Person[] = [];
  const unmatched: string[] = [];
  for (const a of authors) {
    const p = resolvePerson(a);
    if (p) {
      if (!seen.has(p.id)) { seen.add(p.id); matched.push(p); }
    } else if (a?.trim() && !NON_HUMAN.test(a.trim())) {
      unmatched.push(a.trim());
    }
  }
  return { people: matched, unmatched };
}

/**
 * Resolve a person's `headshotOf` to a local ImageMetadata for <Image>.
 * Returns undefined for remote URLs (participants.json has an ImageKit-hosted
 * one) — the caller falls back to a plain <img> for those.
 */
export function headshotFor(person: Person): ImageMetadata | undefined {
  const ref = person.headshotOf;
  if (!ref || /^https?:\/\//.test(ref)) return undefined;
  return headshots.get(stem(ref));
}

export const allPeople = people;
