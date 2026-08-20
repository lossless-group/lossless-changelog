#!/usr/bin/env node
/**
 * Composite title text over a generated illustration and rasterize to JPEG.
 *
 *   node scripts/og-compose/compose.mjs <bg> <W> <H> <out.jpg>
 *
 * Renders through QuickLook (`qlmanage`) rather than a headless browser — no
 * Playwright dependency, and the brand's self-hosted woff2 files load fine by
 * absolute path.
 *
 * THREE QUICKLOOK GOTCHAS drive the shape of this:
 *
 *   1. `qlmanage -t -s N` always renders a SQUARE N×N canvas regardless of the
 *      page's declared size. So the page is square and the banner is a box
 *      centred inside it, cropped back out afterward.
 *   2. QuickLook does NOT render at 1:1 with `-s`. It lays the page out at some
 *      internal CSS width and scales the raster to N, so absolute `px` sizes
 *      come out wrong — a 630px-tall frame rendered ~945px tall inside a 1200px
 *      canvas, pushing the footer below the crop. EVERY dimension here is
 *      therefore relative (`%` / `vw`), which survives the scaling untouched.
 *   3. `sips -z` resizes non-uniformly (squashes). The crop uses `sips -c`,
 *      a true centre-crop, which lands exactly because the frame is centred.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";

const [bg, W, H, out] = process.argv.slice(2);
if (!out) { console.error("usage: compose.mjs <bg> <W> <H> <out.jpg>"); process.exit(2); }
const w = +W, h = +H;
const ABS = process.cwd();
const F = `${ABS}/node_modules/@fontsource-variable`;
const tmp = join(ABS, ".og-tmp");
rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });

/**
 * QuickLook renders a SQUARE canvas, so the frame has to fit inside one. Sizing
 * the frame's height as a percentage of the page worked for landscape and
 * square (<=100%) and silently broke every tall format: at 1080x1350 the frame
 * is 125% of the square's height, overflowing top and bottom and clipping the
 * headline's first line and the footer.
 *
 * The square's side is therefore the LONGER edge, and both frame dimensions are
 * percentages of it — always <=100%, whatever the aspect.
 */
const S = Math.max(w, h);
const frameW = (w / S * 100).toFixed(4);
const frameH = (h / S * 100).toFixed(4);

/**
 * px-at-1200-wide -> vw. `1vw` is a hundredth of the SQUARE, not of the frame,
 * so the conversion carries the frame-to-square ratio or type would shrink on
 * exactly the tall formats that need it largest.
 */
const vw = (pxAt1200) => `${(pxAt1200 * (w / 1200) / S * 100).toFixed(3)}vw`;

/**
 * Type scale per format. A WhatsApp preview renders these at a few hundred
 * pixels wide, so the previous 1.28 on tall frames was far too timid — the
 * headline occupied the top 15% of a square and left a dead middle. Landscape
 * can stay modest because it is already wide relative to its height; square
 * and tall need the type to genuinely fill the upper region.
 */
/**
 * `w >= h` was the wrong test: a 1080x1080 square satisfies it and so took the
 * landscape branch, getting a two-line title at landscape scale and leaving
 * three quarters of its dark region empty. Square is not landscape — only a
 * genuinely wide frame is.
 */
const ratio = w / h;
const isWide = ratio >= 1.5;
/**
 * "Square-ish landscape" (the ai-labs Messages aspect, ~1.17:1) is its own
 * band. It is WIDER than a square but much SHORTER than one, so square-scale
 * type overflows: a three-line headline plus a three-line sub plus the footer
 * pill does not fit in 760px, and the pill lands on top of the last line.
 * Wide enough for a two-line title, short enough to need smaller type.
 */
const isSquarish = ratio > 1.05 && ratio < 1.5;
const k = isWide ? 1.06 : isSquarish ? 1.72 : (ratio <= 0.85 ? 2.35 : 2.3);

/**
 * The headline breaks to three lines on square and tall frames. Those crops
 * carry a large flat dark region ABOVE the art, and that region exists to hold
 * type — leaving it empty wastes the whole reason the crop was made, and
 * leaves the title looking like a caption stranded at the top.
 */
const title = isWide || isSquarish
  ? `The Lossless<br><span class="grad">Changelog</span>`
  : `The<br>Lossless<br><span class="grad">Changelog</span>`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:"Bodoni";font-weight:400 900;src:url("file://${F}/bodoni-moda/files/bodoni-moda-latin-standard-normal.woff2")format("woff2")}
@font-face{font-family:"Figtree";font-weight:300 900;src:url("file://${F}/figtree/files/figtree-latin-wght-normal.woff2")format("woff2")}
@font-face{font-family:"JBMono";font-weight:300 700;src:url("file://${F}/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2")format("woff2")}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden;background:#0d1117}
body{display:flex;align-items:center;justify-content:center}
.frame{position:relative;width:${frameW}%;height:${frameH}%;overflow:hidden;background:#0d1117;
  font-family:"Figtree",ui-sans-serif,system-ui,sans-serif;color:#fff}
.bg{position:absolute;inset:0;background-image:url("file://${resolve(bg)}");
  background-size:cover;background-position:center}
/* The crops already carry a flat dark corner, so the scrim only insures
   against the flow drifting into the type — it does not repaint the frame. */
.scrim{position:absolute;inset:0;background:
  linear-gradient(115deg,rgba(13,17,23,.70) 0%,rgba(13,17,23,.50) 26%,rgba(13,17,23,.14) 48%,rgba(13,17,23,0) 66%),
  linear-gradient(180deg,rgba(13,17,23,.44) 0%,rgba(13,17,23,0) 32%)}
/* A soft halo in the ground colour, anchored on the type and faded to nothing
   before it reaches the art. The corner scrim alone left the headline's
   descenders running into the stems and dot-tips on the right — this is the
   big, same-colour shadow that clears room without flattening the frame or
   putting a visible box behind the text. */
.halo{position:absolute;inset:0;background:
  radial-gradient(${isWide || isSquarish ? "84% 128%" : "104% 74%"} at ${isWide || isSquarish ? "14% 42%" : "10% 34%"},
    rgba(13,17,23,.97) 0%,rgba(13,17,23,.9) 34%,rgba(13,17,23,.6) 54%,
    rgba(13,17,23,.22) 70%,rgba(13,17,23,0) 84%)}
.wrap{position:absolute;z-index:2;top:${vw(56 * k)};left:${vw(58 * k)};right:${vw(48)}}
h1{font-family:"Bodoni",Didot,Georgia,serif;font-size:${vw(74 * k)};line-height:.97;
  letter-spacing:-.025em;font-weight:600;color:#fff;
  text-shadow:0 2px 26px rgba(13,17,23,.92)}
/* The site's ramp puts its last stop at 72.33%, which leaves the final quarter
   of a wide word as flat amber and reads as washed out. The HEX VALUES are the
   brand's, unchanged — only the stop positions are redistributed so all four
   colours land inside the word, plus a display-only saturation lift so the
   ramp holds up against the dark at thumbnail size. This is a rendering
   choice for share imagery, not a token change; theme.css is untouched. */
h1 .grad{background:linear-gradient(100deg,#22a6b5 0%,#9138e0 30%,#d9233b 62%,#f59c49 100%);
  -webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  filter:saturate(1.35) brightness(1.18)}
/* Landscape carries the smallest k, which left the subheader undersized next
   to a 78px headline — it needs its own lift rather than riding the shared
   scale. */
.sub{margin-top:${vw(24 * k)};font-size:${vw(26 * k * (isWide ? 1.34 : 1))};line-height:1.3;
  color:#fff;font-weight:600;max-width:${isWide ? "60%" : isSquarish ? "74%" : "82%"};
  text-shadow:0 1px 3px rgba(13,17,23,1),0 2px 18px rgba(13,17,23,.98)}
.foot{position:absolute;z-index:3;left:${vw(58 * k)};bottom:${vw(40 * k)};display:inline-flex;align-items:center;
  gap:${vw(11 * k)};font-family:"JBMono",ui-monospace,Menlo,monospace;font-size:${vw(19 * k)};
  font-weight:600;letter-spacing:.02em;color:#fff;
  background:rgba(9,12,17,.82);padding:${vw(10 * k)} ${vw(18 * k)};border-radius:999px;
  border:1px solid rgba(255,255,255,.14)}
.foot b{color:rgb(4,229,229);font-weight:600}
.dot{width:${vw(4 * k)};height:${vw(4 * k)};border-radius:50%;background:hsla(0,0%,100%,.45)}
</style>
<div class="frame">
  <div class="bg"></div><div class="scrim"></div><div class="halo"></div>
  <div class="wrap">
    <h1>${title}</h1>
    <p class="sub">Accelerating with Graph, Loop, Harness, and Context Engineering</p>
  </div>
  <div class="foot"><span><b>Check it out</b></span><span class="dot"></span><span>Vibe with us.</span></div>
</div>`;

const page = join(tmp, "page.html");
writeFileSync(page, html);
execFileSync("qlmanage", ["-t", "-s", String(S), "-o", tmp, page], { stdio: "ignore" });
const shot = join(tmp, "page.html.png");
// The frame is centred in the square, so a centre-crop at the target aspect
// lands on it exactly. `sips -c` takes height then width.
execFileSync("sips", ["-c", String(h), String(w), shot, "--out", join(tmp, "crop.png")], { stdio: "ignore" });
execFileSync("magick", [join(tmp, "crop.png"), "-resize", `${w}x${h}!`, "-quality", "92", resolve(out)], { stdio: "ignore" });
console.log(`  ${out}  ${w}x${h}`);
