#!/usr/bin/env node
/**
 * Collect each stream's favicon out of its own repo.
 *
 *   pnpm sync:icons   →  public/icons/<slug>.svg
 *
 * Why copy rather than hotlink: these are the marks of thirty-odd projects
 * whose splash pages come and go, and a filter control that silently loses its
 * icons because a GitHub Pages deploy moved is worse than no icon. Copying
 * also keeps the build offline, matching every other sync here.
 *
 * The search order encodes where this tree actually puts favicons, which is
 * not one place: repos with a splash page keep the project mark under
 * `splash/public/`, plain sites keep it at `public/`, and a couple of nested
 * apps keep it deeper still. `favicon.svg` wins over any decorated variant —
 * content-farm ships a `favicon__BuyMeACoffee.svg` next to its real one, and
 * alphabetical order would pick the wrong file.
 *
 * SVG only. A favicon has to sit legibly at 16px next to a filter label, and
 * the .ico and .afdesign files in this tree are respectively too lossy and not
 * an image format at all.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { findClones } from "./lib/clones.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE = join(ROOT, "../../..");
const MANIFEST = join(ROOT, "src/config/streams.yaml");
const OUT_DIR = join(ROOT, "public/icons");
const OUT_MAP = join(ROOT, "src/stream/_icons.json");
/** Hand-drawn stand-ins, checked in here. See the fill pass at the bottom. */
const LOCAL_DIR = join(ROOT, "src/marks");

/** Where a favicon lives, most-canonical first. */
const CANDIDATES = [
  "splash/public/favicon.svg",
  "public/favicon.svg",
  "site/public/favicon.svg",
  "www/public/favicon.svg",
];

/**
 * Favicons that are not a mark at all.
 *
 * `create astro` scaffolds every new site with the same Astro logo at
 * `public/favicon.svg`, and a site that never replaced it still HAS that file
 * — so the candidate search above finds one and stops, and the ledger ends up
 * showing the Astro logo as if it were the project's brand. Seven streams
 * carried it before this check existed, all byte-identical to each other.
 *
 * Keyed on the file with whitespace collapsed, so a reformat or a change of
 * indentation upstream does not slip a fresh copy past the filter. A new Astro
 * release that redraws the logo will need its signature added here; the
 * symptom is several rows suddenly sharing one mark again.
 */
const STOCK = new Set([
  "3bcf8456919ce2fd09077ceb5d8a592ff46b3482", // astro 5.x default favicon.svg
]);

const isStock = (svg) =>
  STOCK.has(createHash("sha1").update(svg.replace(/\s+/g, "")).digest("hex"));

/**
 * Will a browser actually draw this?
 *
 * SVG is XML, and XML is unforgiving in ways that pass every eyeball review:
 * astro-knots shipped a mark whose comment read `matches --color-accent`, and
 * `--` is illegal inside an XML comment, so the file was undrawable in every
 * browser while looking perfectly correct in an editor. It sat in the ledger as
 * a broken-image square. Cheap to check here, invisible to catch downstream.
 *
 * Deliberately crude — a well-formedness check, not a validator. It looks for
 * the two things that actually bite (illegal `--` in a comment, unescaped `&`)
 * rather than pulling in a parser dependency for a build-time script.
 */
/**
 * Give a monochrome mark an ink colour it can actually be seen in.
 *
 * A favicon drawn with `currentColor` inherits from whatever renders it — and
 * inside an <img>, that is the SVG document's own default, which is black.
 * banner-site's flag is exactly this, and it was legible in the ledger only
 * because a near-white plate used to sit behind every mark. Take the plate away
 * (this page has one mode, and it is dark) and a black-on-transparent mark
 * disappears into the page.
 *
 * CSS cannot reach inside an <img>, so the substitution has to happen here, on
 * the copy. Only monochrome marks are touched, and only by setting the `color`
 * they were already asking to inherit — nothing that specifies its own colours
 * is altered.
 */
const INK = "#e2f2f4"; // colors.on-surface in DESIGN.md
function inkFor(svg) {
  if (!svg.includes("currentColor")) return svg;
  if (/<svg[^>]*\scolor=/.test(svg)) return svg;
  return svg.replace(/<svg\b/, `<svg color="${INK}"`);
}

function xmlFault(svg) {
  const withoutComments = svg.replace(/<!--[\s\S]*?-->/g, "");
  for (const c of svg.match(/<!--[\s\S]*?-->/g) ?? [])
    if (c.slice(4, -3).includes("--")) return "`--` inside an XML comment";
  if (/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);)/.test(withoutComments))
    return "unescaped `&`";
  if (!/<svg[\s>]/.test(svg)) return "no <svg> root";
  return null;
}

/**
 * Does a decorated filename actually belong to this stream?
 *
 * hypernova-site keeps two `favicon__The-Water-Foundation*.svg` files in its
 * public/trademarks dir — leftovers from a different client. Taking those
 * because they were the only SVGs present would put the wrong brand on the
 * filter, which is worse than showing no icon at all. So a decorated variant
 * has to name the project; `favicon__LearnStart--Dark.svg` does, and the TWF
 * ones do not.
 */
function nameMatchesStream(file, stream) {
  const hay = file.toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = `${stream.slug} ${stream.title ?? ""}`
    .toLowerCase().replace(/[^a-z0-9 -]/g, "")
    .split(/[\s-]+/).filter((t) => t.length >= 4 && t !== "site");
  return tokens.some((t) => hay.includes(t));
}

/** Last resort: any favicon*.svg under a public dir, shallowest first. */
function scanForFavicon(dir, depth = 0, best = null) {
  if (depth > 4) return best;
  let items;
  try { items = readdirSync(dir, { withFileTypes: true }); } catch { return best; }
  for (const e of items) {
    if (e.isFile() && /^favicon.*\.svg$/i.test(e.name) && dir.includes("public")) {
      // Prefer the undecorated name at the shallowest depth.
      const plain = e.name.toLowerCase() === "favicon.svg";
      const better = !best || (plain && !best.plain) || (plain === best.plain && depth < best.depth);
      // The scaffold's logo is not a candidate at any depth or filename.
      if (better && !isStock(readFileSync(join(dir, e.name), "utf8")))
        best = { path: join(dir, e.name), plain, depth };
    }
    if (e.isDirectory() && !["node_modules", ".git", "dist", ".vercel", ".astro"].includes(e.name))
      best = scanForFavicon(join(dir, e.name), depth + 1, best);
  }
  return best;
}

const manifest = parseYaml(readFileSync(MANIFEST, "utf8"));
const streams = manifest.streams.filter((s) => s.enabled !== false);

console.log("Locating clones…");
const clones = findClones(TREE);
console.log(`  ${clones.size} clones found\n`);

// Rewrite the directory so a favicon removed upstream stops being served.
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

const map = {};
const missing = [];

for (const s of streams) {
  const dir = clones.get(s.repo.toLowerCase());
  if (!dir) { missing.push(s.slug); continue; }

  // An explicit `icon:` in the manifest outranks every heuristic below. It is
  // for repos whose real mark exists but is not where the search looks —
  // banner-site and twf-site both keep theirs under a decorated name that
  // nameMatchesStream cannot be trusted to guess.
  let src = s.icon ? join(dir, s.icon) : undefined;
  if (src && !existsSync(src)) {
    missing.push(`${s.slug} (declared icon not found: ${s.icon})`);
    continue;
  }

  if (!src) {
    src = CANDIDATES.map((c) => join(dir, c))
      .find((p) => existsSync(p) && !isStock(readFileSync(p, "utf8")));
  }
  if (!src) {
    const found = scanForFavicon(dir);
    // An undecorated favicon.svg is the project's own by definition — unless
    // it is the Astro scaffold's, which names nothing. A decorated one has to
    // prove it.
    if (found && (found.plain || nameMatchesStream(found.path.split("/").pop(), s)))
      src = found.path;
  }
  if (!src) { missing.push(s.slug); continue; }

  const svg = readFileSync(src, "utf8");
  // A favicon that is really a raster wrapped in SVG is no better than a PNG
  // here, and inlining it would bloat every page that shows the filter.
  if (svg.length > 64_000) { missing.push(`${s.slug} (oversized)`); continue; }

  const fault = xmlFault(svg);
  if (fault) { missing.push(`${s.slug} (unparseable: ${fault})`); continue; }

  writeFileSync(join(OUT_DIR, `${s.slug}.svg`), inkFor(svg));
  map[s.slug] = `/icons/${s.slug}.svg`;
  console.log(`  ${s.slug.padEnd(26)} ${src.replace(TREE + "/", "")}`);
}

/**
 * Marks drawn here, for projects that never drew their own.
 *
 * Strictly a placeholder tier: anything in src/marks/ loses the moment a real
 * favicon shows up in the project's own repo, because the loop above runs
 * first and this only fills what it left empty. That ordering is the whole
 * point — these are meant to be replaced without anyone having to remember to
 * come back and delete them.
 */
const stillMissing = new Set(streams.filter((s) => !map[s.slug]).map((s) => s.slug));
const invented = [];
for (const slug of stillMissing) {
  const local = join(LOCAL_DIR, `${slug}.svg`);
  if (!existsSync(local)) continue;
  const svg = readFileSync(local, "utf8");
  const fault = xmlFault(svg);
  if (fault) { missing.push(`${slug} (local mark unparseable: ${fault})`); continue; }
  writeFileSync(join(OUT_DIR, `${slug}.svg`), svg);
  map[slug] = `/icons/${slug}.svg`;
  invented.push(slug);
}
// Drop the ones we just filled, so the closing report stays honest.
for (const slug of invented) {
  const i = missing.indexOf(slug);
  if (i !== -1) missing.splice(i, 1);
}
if (invented.length) console.log(`\ndrawn here (src/marks/): ${invented.join(", ")}`);

writeFileSync(OUT_MAP, JSON.stringify({ generated: null, icons: map }, null, 0) + "\n");
console.log(`\n${Object.keys(map).length} of ${streams.length} streams have an icon`);
if (missing.length) console.log(`no favicon: ${missing.join(", ")}`);
