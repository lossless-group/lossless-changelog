/**
 * Map `owner/name` -> local clone directory, for every repo under the tree.
 *
 * Matching on each clone's ORIGIN REMOTE rather than on directory name is what
 * lets `./content` resolve to lossless-group/lossless-content and
 * `./ai-labs/memopop-ai/apps/memopop-orchestrator` resolve to
 * lossless-group/investment-memo-orchestrator. Several directory names in this
 * tree collide with a different repo entirely, so name-matching would be wrong
 * rather than merely incomplete.
 *
 * Shared by sync-line-classes.mjs and sync-icons.mjs.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/** Submodules nest about four deep; five is enough with room to spare. */
const MAX_DEPTH = 5;

export function findClones(tree, maxDepth = MAX_DEPTH) {
  const found = new Map();
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let items;
    try { items = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    if (items.some((e) => e.name === ".git")) {
      try {
        const url = execFileSync("git", ["-C", dir, "remote", "get-url", "origin"],
                                 { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
        const slug = url.replace(/.*github\.com[:/]/, "").replace(/\.git$/, "").toLowerCase();
        // First clone wins: lossless-content is checked out twice, and the
        // shallower path is the canonical working copy.
        if (slug && !found.has(slug)) found.set(slug, dir);
      } catch { /* not a working clone — keep walking */ }
    }
    for (const e of items) {
      if (!e.isDirectory() || e.name === "node_modules" || e.name === ".git") continue;
      walk(join(dir, e.name), depth + 1);
    }
  };
  walk(tree, 0);
  return found;
}
