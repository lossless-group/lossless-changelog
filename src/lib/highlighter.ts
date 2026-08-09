/**
 * One Shiki highlighter for the entire build.
 *
 * A module-level `let` is NOT sufficient. Vite's SSR module graph re-evaluates
 * a component's module across page renders, so a singleton held in an .astro
 * frontmatter resets constantly — Shiki logged "10, 20, 30 … instances have
 * been created" during a 430-page build, and after roughly 360 blocks the
 * later pages silently stopped highlighting altogether.
 *
 * Caching on `globalThis` survives module re-evaluation because the realm is
 * shared. This is the standard fix for the same class of bug with Prisma
 * clients and DB pools in dev-server environments.
 */
import { createHighlighter, type Highlighter } from "shiki";

/** Languages present in the corpus, plus common aliases. Loading the full
 *  Shiki bundle would pull in hundreds of grammars nothing here uses. */
export const LANGS = [
  "astro", "bash", "css", "diff", "glsl", "html", "ini", "javascript", "json",
  "jsonc", "jsx", "markdown", "mermaid", "python", "ruby", "rust", "shell",
  "sql", "surql", "svelte", "toml", "tsx", "typescript", "vue", "yaml",
];

// One fence tag in the corpus has no grammar anywhere — `cft` (1 block). It
// renders plain, which is the intended outcome rather than a silent gap.

/** github-dark-default's background is #0d1117 — the same value as
 *  --color__github-dark, so highlighted blocks sit flush against the page
 *  ground instead of introducing a second, competing dark. (Plain
 *  `github-dark` is #24292e, which does not match.) */
export const THEME = "github-dark-default";

const KEY = Symbol.for("lossless.changelog.shiki");
type Store = { promise?: Promise<Highlighter> };
const store: Store = ((globalThis as any)[KEY] ??= {});

export function getHighlighter(): Promise<Highlighter> {
  // Never cache a rejection — a single transient failure would otherwise
  // poison every remaining page in the build.
  store.promise ??= createHighlighter({ themes: [THEME], langs: LANGS }).catch((err) => {
    store.promise = undefined;
    throw err;
  });
  return store.promise;
}
