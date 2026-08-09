// @ts-check
import { defineConfig } from 'astro/config';

// Static. Every stream is already on disk under src/stream/ (see `pnpm sync`),
// so the build never touches the network — which is the whole point of syncing
// as a deliberate step rather than at build time.
export default defineConfig({
  site: 'https://changelog.lossless.group',
  output: 'static',
  markdown: { syntaxHighlight: 'prism' },
});
