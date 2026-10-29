---
title: "Maintain an Authors List that Enables Naming Aliases"
lede: "One person, many spellings: Michael Staton, Michael P. Staton, mpstaton. An authors list with aliases makes every byline resolve to one person."
summary: "Plan for this site's people registry (src/content/people/authors.json, src/lib/people.ts). Adds an explicit `aliases` list to each person record, so any spelling, username, or handle in `authors:` frontmatter resolves to one canonical person. Keeps the existing first+last-token signature match as a fallback, and adds a build-time report of author strings that resolve to nobody. Frontmatter in the source repos is never rewritten to match: the registry absorbs the variation. Written so other adopters of the Lossless changelog pattern can copy the registry shape."
site_uuid: dbcae335-b0e2-4b8e-a15b-798a7208e775
hex_code: xsztl2
publish: true
date_created: 2026-10-29
date_modified: 2026-10-29
date_authored_initial_draft: 2026-10-29
date_authored_current_draft: 2026-10-29
authors:
  - Michael Staton
augmented_with:
  - Claude Code on Claude Opus 5.5 (1M context)
at_semantic_version: 0.0.0.1
status: Draft
tags:
  - Changelog
  - Authors
  - People-Registry
  - Naming-Aliases
  - Content-Rollup
type: Plans
---

# Maintain an Authors List that Enables Naming Aliases

## Why Care?

Most entries in the Lossless tree have one author. But the name doesn't arrive one way. Across the 38 streams this site aggregates, the same person shows up as `Michael Staton` (465 entries), `Michael P. Staton` (20), and on other surfaces as the GitHub handle `mpstaton`. Collaborators bring their own variants: a display name in one repo, a username in another, a married name or a nickname a year later.

That's normal, and it gets more normal the moment anyone outside the core team adopts the changelog pattern. A changelog aggregator that treats each spelling as a different person splits one contributor's history into fragments, drops headshots, and miscounts "who shipped what." The fix belongs in one place, the authors list, not in thousands of frontmatter blocks.

## What exists today

- `src/content/people/authors.json`: nine person records, each with `id` (a handle, e.g. `mpstaton`), `name`, `role`, `bio`, `headshotOf`, `socialLinks`.
- `src/content/people/participants.json`: the same shape, for non-author participants.
- `src/lib/people.ts`: `resolvePerson()` matches an author string by `id`, then by a **first+last-token signature** that drops middle initials and punctuation. That's why `Michael P. Staton` already resolves. `NON_HUMAN` filters AI tools that leaked into `authors:` (they belong in `augmented_with`).
- `AuthorHandle.astro` renders resolved people with headshots, and unmatched strings as plain text.

The signature match is a good heuristic, but it is a guess. It can't resolve a username that isn't a name (`benfrank241`), a nickname (`Mike Staton`), or a name change. And it could, in a larger corpus, merge two different people who share a first and last name.

## The change

### 1. Add `aliases` to each person record

```json
{
  "id": "mpstaton",
  "name": "Michael Staton",
  "aliases": ["Michael P. Staton", "Michael Paul Staton", "mpstaton", "M. Staton"],
  ...
}
```

- `name` is the **canonical display name**, what every surface renders.
- `id` stays the stable key (a handle), never changes once assigned.
- `aliases` is every other string that should resolve to this person: spelling variants, usernames on GitHub or other hosts, former names, emails if a repo ever writes those. Case-insensitive.
- An alias belongs to exactly one person. A build check fails if two records claim the same alias.

### 2. Resolution order in `resolvePerson()`

1. Exact `id` match (case-insensitive)
2. Exact `name` or `aliases` match (case-insensitive, trimmed)
3. Signature match, as today, **only when it is unique**: if two people share a signature, return nothing and report it rather than guess
4. Otherwise unmatched

Steps 1–2 are declared facts; step 3 stays as a safety net for variants nobody has listed yet.

### 3. Report what doesn't resolve

At build time, collect every author string across all streams that resolves to nobody and isn't `NON_HUMAN`, with a count and the streams it came from. Write it to the build log (and optionally a `dist/authors-unmatched.json`). That list is the worklist for growing `aliases`: each new variant gets added once, in the registry, and every past and future entry using it resolves.

Also report strings resolved only by the step-3 signature, so they can be promoted to explicit aliases.

### 4. Never rewrite source frontmatter to match

The source repos keep whatever their authors wrote. `Michael P. Staton` in a spec is not an error to sweep; it's a variant the registry knows. This is the same reason the OKF retrofit never edits `authors:` values: the person's name in their own doc is theirs, and the aggregation layer is where identity is reconciled.

(New entries should still use the canonical `name`, per `changelog-conventions`. Aliases are for absorbing the past and the outside world, not a license to drift.)

## Why the registry, not the frontmatter

- **One edit, every surface.** A new alias fixes every entry, in every repo, in every roll-up, at the next build.
- **No mass frontmatter edits.** Scripted rewrites of `authors:` across a corpus are exactly the kind of edit that has broken Astro and Obsidian builds in this tree.
- **Portable.** Anyone adopting the Lossless changelog pattern can copy `authors.json` with `aliases` and get the same behavior. The shape is plain JSON, readable by any aggregator, not just this site.

## Steps

- [ ] Add `aliases` (optional, string array) to the person records in `authors.json` and `participants.json`; seed `mpstaton` with `Michael P. Staton` and `mpstaton`
- [ ] Update `resolvePerson()` to the four-step order; make the signature step refuse ambiguous matches
- [ ] Add the duplicate-alias check (fail the build)
- [ ] Add the unmatched-authors report to the build
- [ ] Run a build, read the report, add the aliases it surfaces
- [ ] Document the registry shape in the README and in `changelog-conventions` (a short note: "byline variants resolve through the authors list")
- [ ] Changelog entry when it ships

## Open questions

1. **Where should the canonical list live?** This site's `authors.json` was extracted from `site/`. If other sites (the corpus splash, the ai-labs splash) render bylines too, the list may want to live once, at the anchor, and be imported. Start here; promote when a second consumer appears.
2. **Should `authors:` ever carry the `id` instead of a name?** Handles are stable where names aren't. Not proposed now: names read better in raw markdown, and aliases make it unnecessary.
3. **Emails.** Git authorship (used by the OKF retrofit to derive `authors`) yields names and emails. If emails ever reach frontmatter, they'd resolve via `aliases` too, but they shouldn't render publicly.

## Related

- `src/lib/people.ts`: the resolver this plan extends
- [[Aggregate-Changelog-Streams-Across-the-Lossless-Tree-via-the-GitHub-API]]: the aggregation that makes variant spellings visible
- `changelog-conventions` skill: `authors` is humans only, always a list
