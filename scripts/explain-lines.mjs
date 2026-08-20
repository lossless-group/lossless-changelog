#!/usr/bin/env node
/**
 * Show how the published line counts were derived — and re-derive them.
 *
 *   pnpm lines:explain
 *
 * The site says "1.96M lines of code". This script exists so that number can
 * be audited rather than trusted: it recomputes every figure from scratch,
 * prints the rule that produced each bucket, and diffs the result against the
 * committed src/stream/_lines.json.
 *
 * It deliberately does NOT read _lines.json to compute — only to compare. If
 * the sync drifted, or someone edited the JSON by hand, this catches it.
 *
 * ── The derivation, in one paragraph ──
 *
 * For every repo in the manifest with a local clone, run
 * `git log --no-merges --no-renames --numstat` and sum the ADDITIONS column
 * per file, bucketing each file by its path. Deletions are ignored: the
 * question is how much was written, not the net size of the tree. Lockfiles
 * and vendored trees are dropped because nobody authored them. There is no
 * scaling, no estimation, and no GitHub data involved — every number is a sum
 * of integers git reported.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { parse as parseYaml } from "yaml";
import { findClones } from "./lib/clones.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TREE = join(ROOT, "../../..");

// Identical to scripts/sync-line-classes.mjs. Duplicated ON PURPOSE: an audit
// that imports the thing it audits can only ever agree with it.
const LOCK = /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|poetry\.lock|Cargo\.lock|uv\.lock|Gemfile\.lock|composer\.lock|go\.sum)$/;
const VENDORED = /(^|\/)(node_modules|dist|build|vendor|reports|\.astro|\.next|\.svelte-kit)\//;
const CONTEXTV = /(^|\/)context-v\//;
const CHANGELOG = /(^|\/)changelogs?(--[a-z0-9-]+)?\//i;

const RULES = [
  ["lock",      "lockfiles — pnpm-lock, package-lock, Cargo.lock, go.sum …", "DROPPED"],
  ["vendored",  "node_modules/ dist/ build/ vendor/ reports/ .astro/ …",     "DROPPED"],
  ["contextv",  "any path under context-v/, OR any repo marked kind: context", "counted"],
  ["changelog", "any path under changelog/ or changelog--*/",                "counted"],
  ["content",   "any repo marked kind: content (its non-changelog files)",   "counted"],
  ["code",      "everything else",                                           "counted"],
];

const manifest = parseYaml(readFileSync(join(ROOT, "src/config/streams.yaml"), "utf8"));
const active = manifest.streams.filter((s) => s.enabled !== false);
const contentRepos = new Set(active.filter((s) => s.kind === "content").map((s) => s.repo.toLowerCase()));
const contextRepos = new Set(active.filter((s) => s.kind === "context").map((s) => s.repo.toLowerCase()));
const repos = [...new Set(active.map((s) => s.repo))];

function classify(path, isContent, isContext) {
  if (LOCK.test(path)) return "lock";
  if (VENDORED.test(path)) return "vendored";
  if (CONTEXTV.test(path)) return "contextv";
  if (CHANGELOG.test(path)) return "changelog";
  if (isContext) return "contextv";
  return isContent ? "content" : "code";
}

console.log("HOW THE LINE COUNTS ARE DERIVED\n");
console.log("  Command, per repo:");
console.log("    git log --no-merges --no-renames --numstat\n");
console.log("  --no-merges   a merge restates changes already counted on the branch");
console.log("  --no-renames  git reports a moved file as 0/0 by default, which would");
console.log("                erase every large reorganisation from the record");
console.log("  additions only — the question is how much was WRITTEN, not net tree size");
console.log("  binary files (git prints '-') contribute nothing\n");
console.log("  Path rules, first match wins:");
for (const [name, rule, fate] of RULES)
  console.log(`    ${name.padEnd(10)} ${fate.padEnd(8)} ${rule}`);
console.log();

const clones = findClones(TREE);
const T = { code: 0, contextv: 0, changelog: 0, content: 0, lock: 0, vendored: 0 };
const missing = [];

for (const repo of repos) {
  const dir = clones.get(repo.toLowerCase());
  if (!dir) { missing.push(repo); continue; }
  let log;
  try {
    log = execFileSync("git", ["-C", dir, "log", "--no-merges", "--no-renames", "--numstat", "--format="],
                       { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();
  } catch { missing.push(repo); continue; }
  const isContent = contentRepos.has(repo.toLowerCase());
  const isContext = contextRepos.has(repo.toLowerCase());
  for (const line of log.split("\n")) {
    const parts = line.split("\t");
    if (parts.length < 3 || parts[0] === "-") continue;
    T[classify(parts.slice(2).join("\t"), isContent, isContext)] += Number(parts[0]) || 0;
  }
}

const counted = T.code + T.contextv + T.changelog + T.content;
const pct = (n) => `${((n / counted) * 100).toFixed(1)}%`;
console.log(`RESULT — ${repos.length - missing.length} repos scanned\n`);
for (const k of ["code", "contextv", "changelog", "content"])
  console.log(`  ${k.padEnd(10)} ${String(T[k]).padStart(10)}  ${pct(T[k]).padStart(6)}`);
console.log(`  ${"TOTAL".padEnd(10)} ${String(counted).padStart(10)}   = ${(counted / 1e6).toFixed(2)}M`);
console.log(`\n  dropped    ${String(T.lock + T.vendored).padStart(10)}   (lockfiles ${T.lock}, vendored ${T.vendored})`);
console.log(`  headline   ${(T.code / 1e6).toFixed(2)}M lines of code`);
if (missing.length) console.log(`\n  no local clone: ${missing.join(", ")}`);

// Compare against what the site actually ships.
const jsonPath = join(ROOT, "src/stream/_lines.json");
if (existsSync(jsonPath)) {
  const repos2 = JSON.parse(readFileSync(jsonPath, "utf8")).repos ?? {};
  const S = { code: 0, contextv: 0, changelog: 0, content: 0 };
  for (const v of Object.values(repos2)) for (const k of Object.keys(S)) S[k] += v[k] ?? 0;
  const drift = Object.keys(S).filter((k) => S[k] !== T[k]);
  console.log(`\nAGAINST src/stream/_lines.json (what the site ships):`);
  if (!drift.length) console.log("  identical — the published numbers are these numbers");
  else for (const k of drift)
    console.log(`  DRIFT ${k}: shipped ${S[k]} vs recomputed ${T[k]} (run pnpm sync:lines)`);
}
