#!/usr/bin/env node
/**
 * Fetch weekly commit volume for every repo in the manifest.
 *
 *   pnpm sync:commits
 *
 * Why this exists: we were disciplined about commits for roughly nine months
 * before we were disciplined about changelogs. A ledger built only from
 * changelog entries therefore claims the work started later than it did. The
 * commit series is the honest floor of the record.
 *
 * Uses /stats/contributors rather than /stats/commit_activity — the latter
 * only covers the trailing year, while contributors returns weekly buckets
 * across the repo's ENTIRE history, with additions and deletions per week.
 *
 * Keyed by REPO, not by stream: memopop-ai backs three streams at different
 * paths, and commit stats are repo-wide. Streams sharing a repo share a series
 * (see lib/commits.ts, which is explicit about that limitation).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src/config/streams.yaml");
const OUT = join(ROOT, "src/stream/_commits.json");

const TOKEN = process.env.GITHUB_TOKEN || process.env.GITHUB_API_TOKEN || "";
const API = "https://api.github.com";

let calls = 0;

/**
 * The stats endpoints compute asynchronously: the first request for a cold
 * repo returns 202 with an empty body and kicks off a background job. Poll
 * until it materializes rather than treating the empty response as "no data" —
 * that would silently record every repo as having zero commits.
 */
async function statsFor(repo, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const headers = { accept: "application/vnd.github+json" };
    if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
    calls++;
    const res = await fetch(`${API}/repos/${repo}/stats/contributors`, { headers });

    if (res.status === 204) return [];            // empty repo
    if (res.status === 404) return null;          // gone / renamed
    if (res.status === 403) throw new Error(`rate limited on ${repo}`);

    if (res.status === 202) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} for ${repo}`);

    const body = await res.json();
    if (Array.isArray(body) && body.length) return body;
    // 200 with an empty array also means "still computing" in practice.
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  return null; // never settled — recorded as unavailable, not as zero
}

const manifest = parseYaml(readFileSync(MANIFEST, "utf8"));
const repos = [...new Set(manifest.streams.filter((s) => s.enabled !== false).map((s) => s.repo))];

if (!TOKEN) console.warn("! No GITHUB_TOKEN — stats endpoints are heavily rate limited.\n");
console.log(`Fetching commit stats for ${repos.length} repos…\n`);

const out = {};
const failed = [];

for (const repo of repos) {
  try {
    const data = await statsFor(repo);
    if (data === null) { failed.push(repo); console.log(`  ${"—".padStart(6)}  ${repo} (unavailable)`); continue; }

    // Collapse per-contributor weeks into one series.
    const weeks = new Map();
    for (const contrib of data) {
      for (const w of contrib.weeks) {
        if (!w.c && !w.a && !w.d) continue;
        const cur = weeks.get(w.w) ?? { c: 0, a: 0, d: 0 };
        cur.c += w.c; cur.a += w.a; cur.d += w.d;
        weeks.set(w.w, cur);
      }
    }
    const series = [...weeks.entries()]
      .sort((x, y) => x[0] - y[0])
      .map(([w, v]) => [w, v.c, v.a, v.d]);

    const commits = series.reduce((n, s) => n + s[1], 0);
    out[repo] = { commits, additions: series.reduce((n, s) => n + s[2], 0),
                  deletions: series.reduce((n, s) => n + s[3], 0), weeks: series };
    console.log(`  ${String(commits).padStart(6)}  ${repo}`);
  } catch (err) {
    failed.push(repo);
    console.error(`  ERROR   ${repo}: ${err.message}`);
  }
}

mkdirSync(dirname(OUT), { recursive: true });
// Preserve any repo we failed on this run rather than dropping its history.
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).repos ?? {} : {};
const merged = { ...prev, ...out };

writeFileSync(OUT, JSON.stringify({ generated: null, repos: merged }, null, 0) + "\n");

const totalCommits = Object.values(merged).reduce((n, r) => n + r.commits, 0);
const totalAdds = Object.values(merged).reduce((n, r) => n + r.additions, 0);
console.log(`\n${Object.keys(merged).length} repos · ${totalCommits.toLocaleString()} commits · ` +
            `+${totalAdds.toLocaleString()} lines · ${calls} API calls`);
if (failed.length) console.error(`\n${failed.length} unavailable: ${failed.join(", ")}`);
