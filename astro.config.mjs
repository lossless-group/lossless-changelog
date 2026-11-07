// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import { cacheVercel } from '@astrojs/vercel/cache';

// Server output: pages render on demand from the live corpus (src/lib/corpus.ts),
// so a push to any stream's repo reaches the site with no rebuild. The build
// itself still never touches the network: src/stream/ (see `pnpm sync`) is the
// bundled baseline a cold instance serves from.
//
// Rendered pages sit on Vercel's CDN under one tag, `content`, and are purged
// on push via the org webhook → lossless-hook-relay → /api/content-hook. One
// tag because nearly every page counts or lists the whole aggregate. maxAge
// (5 min) is the safety net for a missed delivery; GitHub does not retry.
export default defineConfig({
  // The deploy target, and the base for every absolute URL — og:image,
  // og:url, canonical, twitter:image. Getting this wrong does not fail the
  // build: it silently advertises share images on a host that does not exist,
  // which is exactly what happened when this read changelog.lossless.group
  // while the site was only ever served from Vercel.
  //
  // Env-var pattern per context-v/blueprints/Build-a-Fundraise-Deck-Workspace.md:
  // set SITE_URL in Vercel's env panel when the custom domain is attached, and
  // nothing else has to change.
  site: process.env.SITE_URL ?? 'https://lossless-changelog.vercel.app',
  output: 'server',
  adapter: vercel(),
  cache: { provider: cacheVercel() },
  routeRules: {
    '/[...path]': { maxAge: 300, swr: 86400, tags: ['content'] },
  },
  // Astro's markdown pipeline is never used — LFM parses every entry and
  // src/components/markdown renders it, so this setting only ever applied to
  // files Astro processes itself. Leaving it on 'prism' made @astrojs/prism
  // load in dev and spam "Language does not exist: svelte / surql / jsonc"
  // for grammars Prism lacks. Highlighting happens in CodeBlock.astro via
  // Shiki; see src/lib/highlighter.ts.
  markdown: { syntaxHighlight: false },
});
