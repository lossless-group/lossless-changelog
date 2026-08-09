// @ts-check
import { defineConfig } from 'astro/config';

// Static. Every stream is already on disk under src/stream/ (see `pnpm sync`),
// so the build never touches the network — which is the whole point of syncing
// as a deliberate step rather than at build time.
export default defineConfig({
  site: 'https://changelog.lossless.group',
  output: 'static',
  // Astro's markdown pipeline is never used — LFM parses every entry and
  // src/components/markdown renders it, so this setting only ever applied to
  // files Astro processes itself. Leaving it on 'prism' made @astrojs/prism
  // load in dev and spam "Language does not exist: svelte / surql / jsonc"
  // for grammars Prism lacks. Highlighting happens in CodeBlock.astro via
  // Shiki; see src/lib/highlighter.ts.
  markdown: { syntaxHighlight: false },
});
