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

export const allPeople = people;
