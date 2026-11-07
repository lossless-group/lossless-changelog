// Wake-up receiver for lossless-hook-relay, the same contract as
// lossless-toolkit-site and client-portals-site.
//
// The relay forwards { repo, ref, before, after, forced }, signed with
// RELAY_FORWARD_SECRET. The body is a wake-up, not truth: we find the streams
// that read the pushed repo and branch and ask GitHub which of their changelog
// directories the push touched. Every push to such a repo is new commits, so
// its activity is always forgotten and the `content` tag always purged; the
// streams are re-listed only when their entries moved.
export const prerender = false;

import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { SOURCES, TTL, forgetStreams } from '../../lib/corpus';
import { countsPush, forgetRepos } from '../../lib/activity';
import { verify } from '../../lib/hook-signature';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const env = (k: string): string | undefined => (import.meta.env as any)[k] ?? process.env[k];

/** The changed paths of a push, or null when we can't tell. */
async function changedPaths(repo: string, before?: string, after?: string): Promise<string[] | null> {
  if (!before || !after || /^0+$/.test(before) || /^0+$/.test(after)) return null;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'lossless-changelog',
  };
  const t = env('GITHUB_TOKEN') ?? env('GITHUB_API_TOKEN');
  if (t) headers.Authorization = `Bearer ${t}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/compare/${before}...${after}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const files = ((await res.json()).files ?? []) as { filename: string; previous_filename?: string }[];
    if (files.length >= 300) return null; // GitHub truncates compare at 300 files
    return files.flatMap((f) => [f.filename, f.previous_filename].filter((p): p is string => !!p));
  } catch {
    return null;
  }
}

/** Whether a path is an entry of a stream reading `dir` ("" is the repo root). */
const inDir = (path: string, dir: string) =>
  dir ? path.startsWith(dir.endsWith('/') ? dir : `${dir}/`) : !path.includes('/');

export const POST: APIRoute = async (context) => {
  if (context.cache.enabled) context.cache.set(false);
  const raw = await context.request.text();
  if (!verify(raw, context.request.headers.get('x-relay-signature-256'), env('RELAY_FORWARD_SECRET'))) {
    return json(401, { error: 'bad signature' });
  }

  let body: { repo?: string; ref?: string; before?: string; after?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'bad json' });
  }

  const repo = body.repo?.toLowerCase();
  const streams = SOURCES.filter(
    (s) => s.repo.toLowerCase() === repo && (!body.ref || body.ref === `refs/heads/${s.ref}`),
  );
  // A stats-only repo (streams.yaml `stats_only:`) has no streams but still
  // moves the totals.
  const counted = !!repo && countsPush(repo, body.ref);
  if (!repo || (!streams.length && !counted)) return new Response(null, { status: 204 });

  const paths = await changedPaths(body.repo!, body.before, body.after);
  const touched = paths ? streams.filter((s) => paths.some((p) => inDir(p, s.path))) : streams;

  const slugs = touched.map((s) => s.slug);
  forgetStreams(slugs);
  if (counted) forgetRepos([body.repo!]);
  if (context.cache.enabled) await context.cache.invalidate({ tags: ['content'] });

  // Warm the front door and each of the repo's streams, so the first reader after a
  // push doesn't pay for the sync. The pause lets GitHub's API catch up.
  //
  // forgetStreams() only reaches THIS instance. Another one can still serve,
  // and re-cache, its pre-push snapshot until its own check expires. So once
  // every instance's TTL has run out, purge and warm a second time.
  const origin = new URL(context.request.url).origin;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const warmAll = () =>
    Promise.allSettled(
      ['/', ...streams.map((s) => `/stream/${s.slug}/`)].map((p) =>
        fetch(origin + p, { headers: { 'user-agent': 'content-hook-warmer' } }),
      ),
    );
  const cache = context.cache;
  const warm = sleep(1500)
    .then(warmAll)
    .then(() => sleep(TTL + 5000))
    .then(async () => {
      if (cache.enabled) await cache.invalidate({ tags: ['content'] });
      await warmAll();
    });
  try {
    waitUntil(warm);
  } catch {
    /* not on Vercel: let it run */
  }

  return json(202, { purged: true, streams: slugs, cache: context.cache.enabled });
};
