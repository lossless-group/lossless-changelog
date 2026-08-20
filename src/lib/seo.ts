/**
 * Site-wide SEO + OpenGraph registry.
 *
 * One source of truth for titles, descriptions, and share imagery — the
 * astro-knots convention, per `context-v/blueprints/Maintain-an-Elegant-Open-Graph-System.md`
 * and the opengraph-system playbook. The registry is DATA and belongs here,
 * not in the component that renders it.
 *
 * ── One tag, several audiences ──
 *
 * Only X can be given its own image: it reads `twitter:image` in preference to
 * `og:image`. Everyone else — WhatsApp, iMessage, LinkedIn, Slack, Discord,
 * Facebook — reads `og:image`, and there is no standard way to hand them
 * different files. Multiple `og:image` tags do not help; every one of those
 * clients takes the first.
 *
 * The platform is X; the META TAGS are still `twitter:*`. X never renamed
 * them and there is no `x:card` or `x:image` — its crawler still requires
 * `twitter:card`, `twitter:title`, `twitter:image`. Do not "modernise" the
 * prefix; it would silently drop the card.
 *
 * So `og:image` is the SQUARE, chosen for WhatsApp and iMessage — the only
 * places this actually gets shared. LinkedIn would crop it to 1.91:1 and keep
 * 52% of the height, which would matter if we posted there. We don't.
 *
 * Measured against a 1.91:1 centre-crop, for whenever that changes:
 *
 *   Banner      1200x630   100% retained
 *   Square      1080x1080   52%
 *   Portrait    1080x1350   42%
 *   BannerTall   900x1200   39%
 *
 * Precedent: ai-labs/splash ran the same enumerated set in May 2026 and
 * labelled BannerTall as its WhatsApp/iMessage asset. Worth knowing the two
 * house docs disagree about what WhatsApp does to a tall frame — the OG
 * blueprint says it crops to ~1.91:1, the og-images skill says it top-crops
 * and treats 3x4 as the default. A real send is the only ground truth; if the
 * square disappoints in a live thread, `CHAT_OG_IMAGE` swaps in one line.
 *
 * The tall and square exports stay in SHARE_IMAGES because they are the right
 * assets for MANUAL posting — an Instagram or LinkedIn image post where the
 * file is uploaded directly and never passes through an unfurler's crop.
 *
 * ── Constraints these files already satisfy ──
 *
 * - WhatsApp skips (does not downscale) anything over ~600 KB. Largest here is
 *   Portrait at 517 KB; keep new exports under the ceiling.
 * - JPEG, not WebP — WhatsApp's WebP support is intermittent.
 * - `og:image:type` must match the actual bytes or LinkedIn and Slack drop the
 *   image silently. These are real JPEGs, so `image/jpeg` is honest.
 */

export const SITE_NAME = "Lossless Changelog";

export const SITE_TAGLINE =
  "Every ship note across the Lossless tree, aggregated from its source repositories.";

export const OG_IMAGE_ALT =
  "The Lossless Changelog — accelerating with Graph, Loop, Harness, and Context Engineering";

export interface ShareImage {
  path: string;
  width: number;
  height: number;
  type: string;
}

/**
 * Every format the compose pipeline produces, hosted on ImageKit.
 *
 * CDN rather than /public/ so the bytes are served with the right headers from
 * an origin built for it — WhatsApp times out at ~5s and skips anything over
 * ~600KB, and ImageKit content-negotiates: browsers get WebP, unfurlers get
 * JPEG. Verified rather than assumed on these exact URLs:
 *
 *   Accept: image/*       -> content-type: image/jpeg, 77KB, real JPEG magic
 *   Accept: image/webp    -> content-type: image/webp, 49KB
 *
 * That agreement only holds because the SOURCE was uploaded as JPEG. Upload
 * WebP and ImageKit's non-WebP fallback becomes a PNG up to 3x larger, and the
 * bytes stop matching the declared og:image:type — a silent unfurl failure.
 * See the prep-images-for-embed skill; the measurement is its headline finding.
 *
 * Local copies stay in /public/ as an origin-outage fallback and because the
 * compose pipeline writes there. Re-upload with:
 *   node ~/.claude/skills/prep-images-for-embed/scripts/prep-images.mjs \
 *     --slug og-cards --repo lossless-changelog --emit json --src ... --name ... --alt ...
 */
export const SHARE_IMAGES = {
  banner:     { path: "https://ik.imagekit.io/xvpgfijuw/lossless-changelog/og-cards/Ogimage__Lossless-Changelog--Banner_20260820T065134Z.jpg",     width: 1200, height: 630,  type: "image/jpeg" },
  square:     { path: "https://ik.imagekit.io/xvpgfijuw/lossless-changelog/og-cards/Ogimage__Lossless-Changelog--Square_20260820T065134Z.jpg",     width: 1080, height: 1080, type: "image/jpeg" },
  bannerTall: { path: "https://ik.imagekit.io/xvpgfijuw/lossless-changelog/og-cards/Ogimage__Lossless-Changelog--BannerTall_20260820T065134Z.jpg", width: 900,  height: 1200, type: "image/jpeg" },
  portrait:   { path: "https://ik.imagekit.io/xvpgfijuw/lossless-changelog/og-cards/Ogimage__Lossless-Changelog--Portrait_20260820T065134Z.jpg",   width: 1080, height: 1350, type: "image/jpeg" },
  /**
   * The "Messages" aspect — square-ish landscape, sized for the chat cropper
   * directly rather than being cropped into it. Precedent and dimensions from
   * ai-labs/changelog/2026-05-12_03.md: iMessage, WhatsApp, Slack and Discord
   * all crop to roughly this shape, so a 16:9 banner gets letterboxed while
   * this lands in the viewport nearly whole.
   */
  messages:   { path: "https://ik.imagekit.io/xvpgfijuw/lossless-changelog/og-cards/Ogimage__Lossless-Changelog--Messages_20260820T065134Z.jpg",   width: 890,  height: 760,  type: "image/jpeg" },
} as const satisfies Record<string, ShareImage>;

/** `og:image` — every unfurler except X. The Messages aspect, per ai-labs. */
export const CHAT_OG_IMAGE: ShareImage = SHARE_IMAGES.messages;

/**
 * Per-platform share targets.
 *
 * A single page can only advertise one `og:image`, so the way to give each
 * platform its own card is to give each platform its own URL. `/s/<platform>/`
 * is a pre-rendered stub carrying that platform's tags, canonicalised back to
 * the real page and redirecting humans there — the crawler reads the head and
 * never runs the redirect.
 *
 * Static build, so this is a PATH rather than a `?platform=` query: a static
 * page cannot vary its head by query string. If the site ever moves to SSR,
 * a param becomes possible and the URLs get prettier.
 *
 * It degrades safely. A crawler that does follow the redirect lands on the
 * canonical page and reads its tags, which are the chat card and the wide
 * twitter:image — the right answer for every platform in this list anyway.
 */
export const SHARE_TARGETS = {
  whatsapp: { label: "WhatsApp", image: SHARE_IMAGES.messages,
              intent: (u: string) => `https://wa.me/?text=${encodeURIComponent(u)}` },
  imessage: { label: "iMessage", image: SHARE_IMAGES.messages,
              intent: (u: string) => `sms:&body=${encodeURIComponent(u)}` },
  x:        { label: "X",        image: SHARE_IMAGES.banner,
              intent: (u: string) => `https://x.com/intent/post?url=${encodeURIComponent(u)}` },
  slack:    { label: "Slack",    image: SHARE_IMAGES.messages,
              intent: (u: string) => u },
} as const;

export type SharePlatform = keyof typeof SHARE_TARGETS;

/** `twitter:image` — X. Legacy tag name, current platform. */
export const WIDE_OG_IMAGE: ShareImage = SHARE_IMAGES.banner;

/**
 * Where each platform truncates. Trimming here rather than letting the
 * unfurler cut mid-word.
 */
export const CHAR_LIMITS = { title: 65, description: 155 } as const;

export const truncate = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

/** The home page owns the bare site name; everything else is suffixed. */
export const buildPageTitle = (title: string): string =>
  title === SITE_NAME ? title : `${title} · ${SITE_NAME}`;
