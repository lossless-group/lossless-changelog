#!/usr/bin/env node
/**
 * Classify every added line in every manifest repo by WHAT KIND OF LINE it is.
 *
 *   pnpm sync:lines
 *
 * Why this exists: the headline "N million lines" was a lie of composition.
 * GitHub's /stats/contributors — the source behind _commits.json — returns
 * weekly additions per REPO with no path attribution whatsoever, so every line
 * we ever wrote got filed under "code". In this tree that is badly wrong:
 * astro-knots is 71k lines of context-v against 13k of actual code, and
 * lossless-ai-labs is 166k against 38k. Prose is the majority of the work and
 * the chart was crediting it to the compiler.
 *
 * There is no GitHub endpoint that buckets weekly lines by path. Getting it
 * from the API would mean walking all ~4,300 commits individually. Local
 * clones already hold the answer, so we read it from `git log --numstat`.
 *
 * HYBRID BY DESIGN — see lib/lines.ts. This script produces RATIOS, not the
 * published totals. GitHub's per-repo additions stay the denominator so the
 * site's headline stays continuous with what it has always claimed; the local
 * split decides how that number is carved up. The two sources disagree by
 * roughly 40% (GitHub says astro-knots has 190 commits and 158k additions; the
 * repo, verified in sync with origin, has 132 and 122k) and we are not trying
 * to reconcile them here — only to divide the pie.
 *
 * --no-renames is deliberate: git's default rename detection reports a moved
 * file as 0/0, which would erase large reorganizations from the record. It
 * also brings the local number closer to GitHub's own accounting.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src/config/streams.yaml");
const OUT = join(ROOT, "src/stream/_lines.json");
const OUT_DAILY = join(ROOT, "src/stream/_daily.json");

/** The anchor pseudomonorepo — every clone we can reach lives under it. */
const TREE = join(ROOT, "../../..");
/** How deep to walk looking for .git dirs. Submodules nest about four deep. */
const MAX_DEPTH = 5;

// ── path classification ─────────────────────────────────────────────────────

/**
 * Order matters. A lockfile inside context-v/ is still a lockfile, and a
 * changelog entry inside a content repo is still a changelog entry — the
 * kind of line beats the kind of repo that holds it.
 */
const LOCK = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|Cargo\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
/**
 * `reports/` earns its place here alongside the build dirs. Everywhere in this
 * tree it holds machine output, never authored prose: lossless-content keeps
 * eight `evaluation-output` dumps totalling 183k lines inside
 * changelog--content/reports/, plus yamllint runs at its root, and
 * lossless-site keeps open-graph fetch reports. Left in, those dumps alone
 * would overstate the fleet's changelog volume by half.
 */
const VENDORED = /(^|\/)(node_modules|dist|build|vendor|reports|\.astro|\.next|\.svelte-kit)\//;
const CONTEXTV = /(^|\/)context-v\//;
/** `changelog/`, `changelogs/`, and lossless-content's `changelog--code/` trio. */
const CHANGELOG = /(^|\/)changelogs?(--[a-z0-9-]+)?\//i;

function classify(path, repoIsContent) {
  if (LOCK.test(path)) return "lock";
  if (VENDORED.test(path)) return "vendored";
  if (CONTEXTV.test(path)) return "contextv";
  if (CHANGELOG.test(path)) return "changelog";
  return repoIsContent ? "content" : "code";
}

const EMPTY = () => ({ code: 0, contextv: 0, changelog: 0, content: 0, lock: 0, vendored: 0 });

// ── locate local clones ─────────────────────────────────────────────────────

/**
 * Map owner/name -> local directory by reading each clone's origin remote.
 * Matching on the remote rather than on directory name is what lets
 * `./content` resolve to lossless-group/lossless-content, and it refuses to
 * be fooled by the several dirs whose names collide with a different repo.
 */
function findClones() {
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (items.some((e) => e.name === ".git")) {
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"],
                                 { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        const slug = url.replace(/.*github\.com[:/]/, "").replace(/\.git$/, "").toLowerCase();
        // First clone wins: lossless-content is checked out twice (./content and
        // ./site/src/generated-content) and the shallower one is the real one.
        if (slug && !found.has(slug)) found.set(slug, dir);
      } catch { /* not a working clone — keep walking */ }
    }
    for (const e of items) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(TREE, 0);
  return found;
}

// ── main ────────────────────────────────────────────────────────────────────

const manifest = parseYaml(readFileSync(MANIFEST, "utf8"));
const active = manifest.streams.filter((s) => s.enabled !== false);

/** Repos the manifest declares as content rather than code. */
const contentRepos = new Set(
  active.filter((s) => s.kind === "content").map((s) => s.repo.toLowerCase()),
);
const repos = [...new Set(active.map((s) => s.repo))];

console.log(`Locating clones under ${relative(process.cwd(), TREE) || "."}…`);
const clones = findClones();
console.log(`  ${clones.size} clones found\n`);

const out = {};
const missing = [];
const fmt = (n) => String(n).padStart(8);

/**
 * Per-DAY commits and authored lines, summed across every repo.
 *
 * GitHub's stats endpoint only buckets by week, which is too coarse to show
 * what this record is actually about: a solo operator's focus days. The median
 * active day carries 8 commits and the busiest carries 129 — a weekly bucket
 * averages that distinction away entirely. Local history has the resolution,
 * so we take it from there.
 *
 * Keyed YYYY-MM-DD -> [commits, code, contextv, changelog, content].
 */
const daily = new Map();
const dayBucket = (d) => {
  let v = daily.get(d);
  if (!v) { v = { c: 0, code: 0, contextv: 0, changelog: 0, content: 0 }; daily.set(d, v); }
  return v;
};

for (const repo of repos) {
  const dir = clones.get(repo.toLowerCase());
  if (!dir) { missing.push(repo); continue; }

  let log;
  try {
    log = execFileSync(
      "git",
      ["-C", dir, "log", "--no-merges", "--no-renames", "--numstat", "--format=%x01%cs"],
      { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] },
    ).toString();
  } catch (err) {
    missing.push(repo);
    console.error(`  ERROR   ${repo}: ${err.message.split("\n")[0]}`);
    continue;
  }

  const isContent = contentRepos.has(repo.toLowerCase());
  const t = EMPTY();
  let day = null;
  for (const line of log.split("\n")) {
    if (!line) continue;
    // %x01 marks a commit header and carries its date; numstat rows follow as
    // added\tdeleted\tpath.
    if (line.charCodeAt(0) === 1) { day = line.slice(1); dayBucket(day).c += 1; continue; }
    const parts = line.split("\t");
    // "-" in the additions column means a binary file, which has no lines.
    if (parts.length < 3 || parts[0] === "-") continue;
    const kind = classify(parts.slice(2).join("\t"), isContent);
    const n = Number(parts[0]) || 0;
    t[kind] += n;
    // Lockfiles and vendored trees are excluded here too — a focus day should
    // not look productive because a lockfile churned.
    if (day && kind !== "lock" && kind !== "vendored") dayBucket(day)[kind] += n;
  }

  const local = Object.values(t).reduce((a, b) => a + b, 0);
  out[repo] = { local, ...t };
  const authored = local - t.lock - t.vendored;
  console.log(`  ${fmt(authored)} authored  ${repo}` +
              (t.vendored ? `  (+${t.vendored.toLocaleString()} vendored, dropped)` : ""));
}

mkdirSync(dirname(OUT), { recursive: true });
// Never drop a repo just because its clone went missing on one run — a
// temporarily unreachable checkout should not silently rewrite the chart.
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).repos ?? {} : {};
const merged = { ...prev, ...out };
writeFileSync(OUT, JSON.stringify({ generated: null, repos: merged }, null, 0) + "\n");

const sum = (k) => Object.values(merged).reduce((n, r) => n + (r[k] ?? 0), 0);
const authored = sum("code") + sum("contextv") + sum("changelog") + sum("content");
console.log(`\n${Object.keys(merged).length} repos · ${authored.toLocaleString()} authored lines`);
for (const k of ["code", "contextv", "changelog", "content"]) {
  console.log(`  ${k.padEnd(10)} ${fmt(sum(k))}  ${((sum(k) / authored) * 100).toFixed(1)}%`);
}
console.log(`  ${"dropped".padEnd(10)} ${fmt(sum("lock") + sum("vendored"))}  (lockfiles + vendored)`);
// Daily series is a full rewrite each run, not merged: it is derived from the
// same scan, and a stale day carried forward would misreport a quiet week.
const dailyOut = {};
for (const [d, v] of [...daily.entries()].sort())
  dailyOut[d] = [v.c, v.code, v.contextv, v.changelog, v.content];
writeFileSync(OUT_DAILY, JSON.stringify({ generated: null, days: dailyOut }, null, 0) + "\n");

const surge = Object.values(dailyOut).filter(([c]) => c > 10).length;
console.log(`${Object.keys(dailyOut).length} active days · ${surge} with more than 10 commits`);

if (missing.length) console.error(`\n${missing.length} without a local clone: ${missing.join(", ")}`);
