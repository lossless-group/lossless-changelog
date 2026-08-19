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
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { findClones } from "./lib/clones.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE = join(ROOT, "../../..");
const MANIFEST = join(ROOT, "src/config/streams.yaml");
const OUT_DIR = join(ROOT, "public/icons");
const OUT_MAP = join(ROOT, "src/stream/_icons.json");

/** Where a favicon lives, most-canonical first. */
const CANDIDATES = [
  "splash/public/favicon.svg",
  "public/favicon.svg",
  "site/public/favicon.svg",
  "www/public/favicon.svg",
];

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
      if (!best || (plain && !best.plain) || (plain === best.plain && depth < best.depth))
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

  let src = CANDIDATES.map((c) => join(dir, c)).find((p) => existsSync(p));
  if (!src) {
    const found = scanForFavicon(dir);
    // An undecorated favicon.svg is the project's own by definition. A
    // decorated one has to prove it.
    if (found && (found.plain || nameMatchesStream(found.path.split("/").pop(), s)))
      src = found.path;
  }
  if (!src) { missing.push(s.slug); continue; }

  const svg = readFileSync(src, "utf8");
  // A favicon that is really a raster wrapped in SVG is no better than a PNG
  // here, and inlining it would bloat every page that shows the filter.
  if (svg.length > 64_000) { missing.push(`${s.slug} (oversized)`); continue; }

  writeFileSync(join(OUT_DIR, `${s.slug}.svg`), svg);
  map[s.slug] = `/icons/${s.slug}.svg`;
  console.log(`  ${s.slug.padEnd(26)} ${src.replace(TREE + "/", "")}`);
}

writeFileSync(OUT_MAP, JSON.stringify({ generated: null, icons: map }, null, 0) + "\n");
console.log(`\n${Object.keys(map).length} of ${streams.length} streams have an icon`);
if (missing.length) console.log(`no favicon: ${missing.join(", ")}`);
