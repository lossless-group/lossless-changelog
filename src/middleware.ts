// Bring stale streams and repo activity up to their sources before any
// on-demand render. Cheap when nothing moved (conditional GitHub requests, at
// most one per stream and one per repo each minute per instance), and it never
// throws: whatever fails serves its last good snapshot.
import { defineMiddleware } from 'astro:middleware';
import { syncCorpus } from './lib/corpus';
import { syncActivity } from './lib/activity';
import { refreshCommits } from './lib/commits';
import { refreshDaily } from './lib/daily';
import { refreshLines } from './lib/lines';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) {
    await Promise.all([syncCorpus(), syncActivity()]);
    refreshCommits();
    refreshDaily();
    refreshLines();
  }
  return next();
});
