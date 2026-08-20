// @ts-check
import { defineConfig } from 'astro/config';

// Static. Every stream is already on disk under src/stream/ (see `pnpm sync`),
// so the build never touches the network — which is the whole point of syncing
// as a deliberate step rather than at build time.
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
  output: 'static',
  // Astro's markdown pipeline is never used — LFM parses every entry and
  // src/components/markdown renders it, so this setting only ever applied to
  // files Astro processes itself. Leaving it on 'prism' made @astrojs/prism
  // load in dev and spam "Language does not exist: svelte / surql / jsonc"
  // for grammars Prism lacks. Highlighting happens in CodeBlock.astro via
  // Shiki; see src/lib/highlighter.ts.
  markdown: { syntaxHighlight: false },
});
