---
version: alpha
name: "Lossless Changelog — Aggregate Ledger, Dark"
description: >-
  The house style of The Lossless Group's aggregate changelog. Dark by decision,
  not by mode. A four-stop brand gradient carries chronology rather than
  decoration, three type families sit in deliberate tension, and the signature
  element is a chart, not an ornament.

colors:
  # Grounds
  surface-base: "#0d1117"
  surface: "#1c1520"
  surface-alt: "#0e1116"
  border: "rgba(255, 255, 255, 0.1)"

  # Text
  on-surface: "#e2f2f4"
  on-surface-muted: "rgba(255, 255, 255, 0.7)"
  on-surface-dim: "rgba(255, 255, 255, 0.45)"

  # Brand
  primary: "#04e5e5"
  accent: "#9138e0"
  warn: "#f59c49"

  # The four stops of the era ramp. These are load-bearing DATA, not decoration
  # — lib/era.ts samples them to colour every mark by its date.
  era-1: "#22a6b5"
  era-2: "#9138e0"
  era-3: "#d9233b"
  era-4: "#f59c49"

typography:
  display:
    fontFamily: "Bodoni Moda Variable, Bodoni Moda, Didot, Georgia, serif"
    fontSize: "clamp(2.6rem, 8vw, 5.4rem)"
    fontWeight: 500
    lineHeight: 0.94
    letterSpacing: "-0.03em"
  heading:
    fontFamily: "Figtree Variable, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.7rem, 3.4vw, 2.4rem)"
    fontWeight: 500
  body:
    fontFamily: "Figtree Variable, Figtree, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: 1.6
  mono-sm:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.82rem"
  mono-xs:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "0.72rem"
    letterSpacing: "0.1em"
  hand:
    fontFamily: "Poor Story Regular, Indie Flower, Gaegu, cursive"

rounded:
  sm: "2px"
  md: "10px"
  full: "999px"

spacing:
  measure: "68ch"
  shell: "1120px"
  ledger-height: "116px"

components:
  ledger-strip:
    backgroundColor: transparent
    markFill: "{colors.era-1}"
    areaFill: "{colors.on-surface}"
    baseline: "{colors.border}"
  line-bar:
    backgroundColor: "{colors.surface-alt}"
    segmentFill: "{colors.on-surface}"
    rounded: "{rounded.sm}"
  filter-chip:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-dim}"
    borderColor: "{colors.border}"
    activeBorderColor: "{colors.primary}"
    typography: "{typography.mono-xs}"
    rounded: "{rounded.full}"
  entry-row:
    accentBorder: "{colors.era-4}"
    titleTypography: "{typography.heading}"
    metaTypography: "{typography.mono-xs}"

imagery:
  style_reference:
    path: "public/ogimage__Lossless-Changelog--Default.jpg"
  defaults:
    style_type: AUTO
    magic_prompt: "OFF"
    rendering_speed: QUALITY
    num_images: 4
    seed: 811724
  color_palette:
    members:
      - color_hex: "#0d1117"
        color_weight: 0.45
      - color_hex: "#22a6b5"
        color_weight: 0.2
      - color_hex: "#9138e0"
        color_weight: 0.15
      - color_hex: "#d9233b"
        color_weight: 0.1
      - color_hex: "#f59c49"
        color_weight: 0.1
  aspect_ratios:
    banner: "16x9"
    banner_tall: "3x4"
    banner_tall_max: "2x3"
    portrait: "4x5"
    portrait_tall: "9x16"
    square: "1x1"
  negative_prompt: "text, letters, words, logos, watermark, subject in top half, clutter"
---

# Lossless Changelog — Design

> The runtime source of truth is `src/styles/theme.css`. This document is the
> human- and agent-readable contract that explains intent. Keep the two in sync
> when either changes.

## Brand & Style

A ledger, not a landing page. The register is **a journal of record that turns
into a terminal as you scroll** — broad and editorial at the top, dense and
technical by the bottom. That is the changelog convention's four-audience
cascade made literal in type and layout.

Dark **by decision, not by mode**. The theme-system skill specifies a
three-mode contract (light / dark / vibrant), and that contract exists for
stakeholder management on client sites. Lossless Group is the house brand: the
identity is dark, the cyan accent only reads against dark, and the gradient is
tuned luminous-on-dark. On white it would not be a light mode — it would be a
different brand. Tier 2 still lives behind `:root, [data-mode="dark"]` so
adding a mode later is authoring one block rather than refactoring every token.

## Colors

The four-stop **era ramp** — teal, purple, crimson, amber — is the identity
asset, and here it carries information rather than decoration. `lib/era.ts`
samples it at an entry's normalized position between the corpus's oldest and
newest ship note. **Hue means WHEN.** Teal is early 2025; amber is now.

That one rule governs every other colour decision on the site. Anything that
isn't chronological must not take a hue from the ramp, or the reader stops
being able to trust the thing they were taught to read. It is why the
line-kind bar separates code from context-v from changelog by *value* alone,
and why focus-day marks are drawn in the text colour rather than an accent.

`primary` (cyan) is reserved for links, focus rings, and active state.
Everything else is a ground, a rule, or text at one of three weights.

## Typography

Three families in deliberate tension:

- **Bodoni Moda** — display only. A high-contrast didone on a terminal-dark
  ground is the risk the page takes on purpose. Its italic is the most
  characterful thing either face does, so it is spent exactly once, on a verb.
- **Figtree** — prose. Humanist, quiet, gets out of the way.
- **JetBrains Mono** — data. Every number, label, date, and axis tick.

Poor Story is carried for handwritten annotation and is currently unused here.

The split is the argument: if a thing is a *measurement*, it is set in mono. If
it is a *claim*, it is set in Figtree. If it is the page's one assertion, it is
Bodoni.

## Layout & Spacing

A `1120px` shell with a `68ch` measure for prose. The ledger strip and the
project ledger deliberately break the shell to full-bleed, because a time
series reads better wide and a text column does not.

Vertical rhythm is loose rather than gridded — sections separate by ~3.5rem,
rows by ~1rem.

## Elevation & Depth

Flat. There are no shadows anywhere. Depth is signalled by **ground value
only** — `surface-alt` behind the strip, `surface` behind an active chip — and
by hairline borders at 10% white. A dark UI that leans on shadow reads as
muddy; one that leans on value reads as engineered.

## Shapes

Three radii and no more. `2px` for data marks and swatches, `10px` for cards
and tags, `999px` for filter chips. Data marks are nearly square because a
rounded bar misreports its own height at small sizes.

## Components

### LedgerStrip

The signature element. Pure SVG, no client JS, no chart library. Entry marks
per day above a baseline, daily commit volume as a filled area with an outline
behind them, focus days as heavier columns. Both scales are linear and clipped
at the 95th percentile — a sqrt scale against the outlier rendered 69% of days
indistinguishable.

### LineBar

Stacked bar of lines by kind. **Monochrome by rule** — see Colors.

### ProjectRow

Name, per-project favicon, outbound links, compact sparkline, count. The row is
a plain element and the title is the link; an `<a>` inside an `<a>` is invalid
and browsers recover from it unpredictably.

### Filter chips

Radio group styled as pills, isolating the feed by pseudomonorepo. Pure CSS via
`:has()`.

## Imagery

Share imagery follows the `generate-consistent-og-images` recipe: a wordless
Ideogram illustration with title text composited afterward as SVG. Every
channel is locked at this document's `imagery:` block — only the prompt and the
aspect ratio vary per request.

The subject canon for this project is **an accumulating record**: strata,
ledgers, stacked marks, sedimentary layers, a long horizontal series. Avoid
calendar and clock metaphors — the site is about volume and cadence, not dates.

Empty region goes **top**, per the composition rule, because the overlay
carries the wordmark and title there.

## Do's and Don'ts

**Do** keep hue for chronology. If something new needs distinguishing, reach
for value, weight, or shape first.

**Do** clip data scales at a percentile, not the maximum. One 27-entry day
against a median of 2 will flatten every other day into a band.

**Do** leave headroom above a clipped value. Flush to the ceiling reads as
cropped, not capped.

**Don't** put a plate behind a project favicon. These marks already carry their
own grounds — `ai-labs` and `content-farm` ship a background rect and
`astro-knots` is transparent line-art. A white swatch behind them is what made
the Astro Knots knot render as a white square.

**Don't** use `<fieldset>` for a control group. Its UA chrome has to be fought
in every browser; `<div role="group" aria-label>` is the same semantics with
none.

**Don't** import a package this repo does not declare. Three fonts and `shiki`
resolved for months from the parent pseudomonorepo's `node_modules` and broke
the moment Vercel built the repo alone.
