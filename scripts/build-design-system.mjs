#!/usr/bin/env node
/**
 * Build the Claude Design bundle from the LIVE theme.
 *
 * Every preview inlines src/styles/theme.css verbatim rather than restating
 * token values, so a card can never drift from what the site actually renders.
 * If a token changes, re-run this and re-push; the cards follow.
 *
 *   node scripts/build-design-system.mjs   →  writes design-system/
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "design-system");
const theme = readFileSync(join(ROOT, "src/styles/theme.css"), "utf8");

const FONTS = `
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900&family=Figtree:wght@300..900&family=JetBrains+Mono:wght@300..700&display=swap" rel="stylesheet">
<style>
  /* The site self-hosts these via @fontsource; the preview pulls the same
     families from Google so a card renders standalone in the Design pane. */
  :root, [data-mode="dark"] {
    --font-display: "Bodoni Moda", Didot, Georgia, serif;
    --font-body: "Figtree", ui-sans-serif, system-ui, sans-serif;
    --font-heading: var(--font-body);
    --font-mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  }
</style>`;

function page({ card, title, body, pad = "2rem" }) {
  return `<!-- @dsCard group="${card.group}" name="${card.name}" -->
<!doctype html>
<html lang="en" data-mode="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
${FONTS}
<style>
${theme}
  body { padding: ${pad}; }
  .ds-h { font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: 0.16em;
          text-transform: uppercase; color: var(--color-text-faint); margin: 0 0 0.9rem; }
  .ds-sec + .ds-sec { margin-top: 2.25rem; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

const files = {};

/* ── Colour ─────────────────────────────────────────────────────────────── */
const swatch = (name, token) => `
  <div class="sw">
    <div class="chip" style="background:var(${token})"></div>
    <code>${name}</code>
  </div>`;

files["foundations/color.html"] = page({
  card: { group: "Foundations", name: "Colour" },
  title: "Colour",
  body: `
<section class="ds-sec">
  <p class="ds-h">Brand gradient — eastern crimson, 107°</p>
  <div style="height:84px;border-radius:var(--radius);background:var(--gradient-primary)"></div>
  <p style="font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-faint);margin:.6rem 0 0">
    #22a6b5 5.36% → #9138e0 23.14% → #d9233b 47.56% → #f59c49 72.33%
  </p>
</section>

<section class="ds-sec">
  <p class="ds-h">Semantic — the only tier components read</p>
  <div class="grid">
    ${["--color-bg","--color-surface","--color-surface-alt","--color-text","--color-text-muted","--color-text-faint","--color-heading","--color-primary","--color-accent","--color-warn"].map(t=>swatch(t,t)).join("")}
  </div>
</section>

<section class="ds-sec">
  <p class="ds-h">Temporal ramp — hue encodes when, not what</p>
  <div style="height:44px;border-radius:var(--radius);background:linear-gradient(90deg,#22a6b5,#9138e0,#d9233b,#f59c49)"></div>
  <p style="color:var(--color-text-muted);font-size:var(--text-sm);max-width:60ch;margin:.7rem 0 0">
    The gradient is sampled by an entry's position between the oldest and newest
    ship note. Teal is the start of the record, amber is now. Use it only where
    chronology is the point; anything that just wants a brand colour uses
    <code style="font-family:var(--font-mono)">--color-primary</code>.
  </p>
</section>

<style>
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:.8rem; }
  .sw .chip { height:52px; border-radius:8px; border:1px solid var(--color-border); }
  .sw code { display:block; font-family:var(--font-mono); font-size:.68rem;
             color:var(--color-text-faint); margin-top:.35rem; }
</style>`,
});

/* ── Type ───────────────────────────────────────────────────────────────── */
files["foundations/type.html"] = page({
  card: { group: "Foundations", name: "Typography" },
  title: "Typography",
  body: `
<section class="ds-sec">
  <p class="ds-h">Display — Bodoni Moda</p>
  <p style="font-family:var(--font-display);font-size:clamp(2.4rem,7vw,4.4rem);font-weight:500;line-height:.95;letter-spacing:-.03em;margin:0">
    Everything<br>we <em style="font-style:italic;font-weight:400;background:var(--gradient-primary);-webkit-background-clip:text;background-clip:text;color:transparent">shipped</em>.
  </p>
  <p style="color:var(--color-text-muted);font-size:var(--text-sm);max-width:62ch;margin:1rem 0 0">
    A high-contrast didone on a terminal-dark ground. Headlines and entry titles
    only — it is the journal-of-record voice at the top of the cascade. The
    italic is the most characterful thing either face does, so it is spent once,
    on a verb.
  </p>
</section>

<section class="ds-sec">
  <p class="ds-h">Body — Figtree</p>
  <p style="font-size:var(--text-lg);max-width:62ch;margin:0 0 .6rem">
    392 entries from 37 projects. Each mark is a day we shipped — pulled from
    every repository's own changelog and merged into one record.
  </p>
  <p style="color:var(--color-text-muted);max-width:62ch;margin:0">
    Prose, ledes, and interface copy. Humanist enough to read long, neutral
    enough not to fight the display face.
  </p>
</section>

<section class="ds-sec">
  <p class="ds-h">Mono — JetBrains Mono</p>
  <p style="font-family:var(--font-mono);margin:0 0 .6rem">08 August, 2026 · augment-it · rebuild/turbo-rsbuild</p>
  <p style="color:var(--color-text-muted);font-size:var(--text-sm);max-width:62ch;margin:0">
    Dates, counts, refs, tags, eyebrows, code. Everything the engineering half of
    the audience scans rather than reads.
  </p>
</section>

<section class="ds-sec">
  <p class="ds-h">Scale</p>
  <div style="display:grid;gap:.45rem">
    ${[["--text-display","Display"],["--text-2xl","2XL"],["--text-xl","XL"],["--text-lg","LG"],["--text-base","Base"],["--text-sm","SM"],["--text-xs","XS"]]
      .map(([t,l])=>`<div style="display:flex;align-items:baseline;gap:1rem"><code style="font-family:var(--font-mono);font-size:.68rem;color:var(--color-text-faint);width:8rem;flex:none">${t}</code><span style="font-size:var(${t});line-height:1.1">${l}</span></div>`).join("")}
  </div>
</section>`,
});

/* ── Ledger strip ───────────────────────────────────────────────────────── */
const stops = ["#22a6b5", "#9138e0", "#d9233b", "#f59c49"];
const offs = [0.0536, 0.2314, 0.4756, 0.7233];
const hex2 = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
function ramp(t) {
  if (t <= offs[0]) return stops[0];
  if (t >= offs[3]) return stops[3];
  for (let i = 0; i < 3; i++) {
    if (t >= offs[i] && t <= offs[i + 1]) {
      const k = (t - offs[i]) / (offs[i + 1] - offs[i]);
      const a = hex2(stops[i]), b = hex2(stops[i + 1]);
      return "#" + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, "0")).join("");
    }
  }
  return stops[3];
}
// Deterministic pseudo-cadence — no Math.random, so the card is stable across
// rebuilds and diffs cleanly.
let marks = "";
for (let i = 0; i < 260; i++) {
  const t = i / 259;
  const burst = (Math.sin(i * 0.7) + Math.sin(i * 0.23) + 2) / 4;
  const h = 8 + burst * 84;
  marks += `<rect x="${(14 + t * 972).toFixed(1)}" y="${((116 - h) / 2).toFixed(1)}" width="1.6" height="${h.toFixed(1)}" rx=".8" fill="${ramp(t)}"/>`;
}

files["components/ledger-strip.html"] = page({
  card: { group: "Components", name: "Ledger strip" },
  title: "Ledger strip",
  body: `
<p class="ds-h">Signature element</p>
<figure style="margin:0;background:var(--color-surface-alt);border-block:1px solid var(--color-border);padding:1.1rem 1.25rem .5rem">
  <svg viewBox="0 0 1000 116" preserveAspectRatio="none" style="display:block;width:100%;height:116px" role="img" aria-label="Shipping cadence">
    <line x1="610" x2="610" y1="0" y2="116" stroke="var(--color-border)"/>
    ${marks}
  </svg>
  <figcaption style="position:relative;height:1.1rem;margin-top:.4rem;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--color-text-faint)">
    <span style="position:absolute;left:0;color:var(--color-text-muted)">Jan 2025</span>
    <span style="position:absolute;left:61%;transform:translateX(-50%)">2026</span>
    <span style="position:absolute;left:100%;transform:translateX(-100%);color:var(--color-text-muted)">Aug 2026</span>
  </figcaption>
</figure>
<p style="color:var(--color-text-muted);max-width:64ch;margin:1.1rem 0 0">
  One hairline per day the fleet shipped, placed on the x-axis by date and
  coloured by where it falls in the record. Height is entries-that-day, square-rooted
  so a busy day reads without erasing the quiet ones. Density is velocity, gaps are
  quiet weeks, hue is when — no legend, because the same ramp colours dates
  everywhere else on the site.
</p>
<p style="color:var(--color-text-faint);font-size:var(--text-sm);max-width:64ch;margin:.7rem 0 0">
  Pure SVG, no client JS, no chart library. A <code style="font-family:var(--font-mono)">compact</code>
  variant drops the axis and shrinks to 26px for use as a per-project sparkline —
  always scaled to the GLOBAL span so projects stay comparable.
</p>`,
  pad: "2rem 0",
});

/* ── Entry row ──────────────────────────────────────────────────────────── */
const row = (accent, date, origin, title, lede, tags) => `
<article style="position:relative;padding:1.15rem 0 1.15rem 1rem;border-bottom:1px solid var(--color-border)">
  <span style="position:absolute;inset:1.15rem auto 1.15rem 0;width:2px;border-radius:2px;background:${accent}"></span>
  <div style="display:flex;align-items:center;gap:.65rem;flex-wrap:wrap;font-size:var(--text-xs);color:var(--color-text-faint);margin-bottom:.3rem">
    <time style="font-family:var(--font-mono)">${date}</time>
    <span style="color:var(--color-text-muted)">${origin}</span>
  </div>
  <h3 style="margin:0 0 .35rem;font-size:var(--text-lg);line-height:1.3;font-weight:600;letter-spacing:-.012em">${title}</h3>
  <p style="margin:0;max-width:68ch;color:var(--color-text-muted);font-size:.92rem">${lede}</p>
  <ul style="list-style:none;display:flex;gap:.3rem;margin:.5rem 0 0;padding:0">
    ${tags.map((t) => `<li style="font-family:var(--font-mono);font-size:.68rem;padding:.1rem .4rem;border-radius:var(--radius);background:var(--color-surface-alt);color:var(--color-text-faint)">${t}</li>`).join("")}
  </ul>
</article>`;

files["components/entry-row.html"] = page({
  card: { group: "Components", name: "Entry row" },
  title: "Entry row",
  body: `
<p class="ds-h">Feed item · accent restates the temporal ramp</p>
${row("#f59c49", "08 August, 2026", "component · Investment Memo Orchestrator", "The corpora were never missing — one bad message had killed the subject", "A single malformed message poisoned the subject index, and every downstream corpus read as empty. The data was intact the whole time.", ["Debugging", "Corpora", "Root-Cause"])}
${row("#d9233b", "12 May, 2026", "fleet · Astro Knots", "Sweep: LFM 0.3.0, Astro 6.3.1, and OpenPanel layered across the fleet", "Eleven sites bumped in one pass, with the analytics layer landing behind a single shared component.", ["Dependency-Upgrade", "Fleet-Wide"])}
${row("#9138e0", "03 November, 2025", "product · MemoPop AI", "Sources capture their own bibliography", "Authors, publisher, and date now travel with the source rather than being re-derived at render time.", ["Citations", "Schema"])}
${row("#22a6b5", "18 January, 2025", "component · Cite Wide", "Hex citations, day one", "The retrospective that should have been written when Cite-Wide's identity emerged, filed sixteen months late.", ["Retrospective"])}
<p style="color:var(--color-text-muted);max-width:64ch;margin:1.2rem 0 0">
  The 2px rule carries the same hue the ledger strip gives that day, so scanning
  the feed and scanning the strip teach the same colour vocabulary. Ledes clamp
  to three lines — across three years of convention drift they range from one
  line to full paragraphs, and one stray long one would dominate the column.
</p>`,
});

/* ── Author ─────────────────────────────────────────────────────────────── */
files["components/author.html"] = page({
  card: { group: "Components", name: "Author byline" },
  title: "Author byline",
  body: `
<p class="ds-h">Byline · headshot, initials fallback, augmentation</p>
<div style="display:flex;align-items:center;flex-wrap:wrap;gap:.75rem;margin-bottom:1.6rem">
  <span style="display:inline-flex;align-items:center;gap:.45rem">
    <span style="width:2rem;height:2rem;border-radius:999px;display:grid;place-items:center;background:var(--gradient-primary);box-shadow:0 0 0 1px var(--color-border);font-size:.7rem;font-weight:700">MS</span>
    <span style="display:flex;flex-direction:column;line-height:1.25">
      <span style="font-size:.85rem">Michael Staton</span>
      <span style="font-size:.72rem;color:var(--color-text-faint)">Coordinator of The Lossless Group</span>
    </span>
  </span>
  <span style="font-size:.72rem;color:var(--color-text-faint);border-left:1px solid var(--color-border);padding-left:.75rem">
    augmented with Claude Code on Opus 5
  </span>
</div>
<p style="color:var(--color-text-muted);max-width:64ch;margin:0">
  Names resolve to people by first+last token, not substring — "Michael P. Staton"
  and "Michael Staton" are the same person and substring matching gets that wrong
  in both directions. AI tooling that authors put in <code style="font-family:var(--font-mono)">authors:</code>
  resolves to nobody and surfaces in the augmentation slot instead, per the
  humans-only rule. A person with no record yet renders as a bare name rather
  than empty avatar chrome.
</p>`,
});

/* ── Altitude ───────────────────────────────────────────────────────────── */
files["components/altitude.html"] = page({
  card: { group: "Components", name: "Altitude badge" },
  title: "Altitude badge",
  body: `
<p class="ds-h">Tree depth, derived not declared</p>
<div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:1.4rem">
  <span class="altitude" data-a="fleet">fleet</span>
  <span class="altitude" data-a="product">product</span>
  <span class="altitude" data-a="component">component</span>
</div>
<p style="color:var(--color-text-muted);max-width:64ch;margin:0">
  Altitude is computed from a stream's depth in the manifest tree — depth 1 is a
  fleet, 2 a product, 3 a component. It is never hand-declared, because a
  declared value and a parent pointer can disagree and then one of them is lying.
  Colour separates the tiers without implying rank: fleet takes the brand accent,
  product the secondary, component stays neutral.
</p>`,
});

mkdirSync(OUT, { recursive: true });
for (const [path, html] of Object.entries(files)) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, html);
  console.log(`  ${path.padEnd(34)} ${(html.length / 1024).toFixed(1)} KB`);
}
console.log(`\n${Object.keys(files).length} cards → ${OUT}`);
