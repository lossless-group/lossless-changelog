// Bring stale streams up to their sources before any on-demand render. Cheap
// when nothing moved (one conditional GitHub request per stream at most every
// minute per instance), and it never throws: a failed stream serves its last
// good snapshot.
import { defineMiddleware } from 'astro:middleware';
import { syncCorpus } from './lib/corpus';

export const onRequest = defineMiddleware(async (context, next) => {
  if (!context.isPrerendered) await syncCorpus();
  return next();
});
