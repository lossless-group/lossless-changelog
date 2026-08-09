/**
 * Temporal color mapping — the design thesis of this site.
 *
 * The Lossless brand gradient is a four-stop ramp: teal → purple → crimson →
 * amber. An aggregate changelog is fundamentally a time series. So rather than
 * using the gradient as decoration, we map it onto the corpus's own time axis:
 * an entry's position between the oldest and newest ship note determines its
 * accent. Teal is 2025, amber is now.
 *
 * That makes the brand mark carry information — density and hue in the ledger
 * strip read as "when" and "how fast" without a legend. Anything that just
 * wanted a nice color should use --color-primary instead; reach for this only
 * where chronology is the point.
 */

/** The gradient's own stops, in order. Values from --gradient__eastern-crimson. */
const STOPS = ["#22a6b5", "#9138e0", "#d9233b", "#f59c49"] as const;

/** Stop offsets, matching the 107deg gradient's percentages, normalized. */
const OFFSETS = [0.0536, 0.2314, 0.4756, 0.7233] as const;

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return `#${[c(r1, r2), c(g1, g2), c(b1, b2)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

/**
 * Sample the brand gradient at `t` (0..1). Clamps outside the first and last
 * stop rather than extrapolating, so early and late entries sit ON the brand
 * colors instead of drifting off the end of the ramp into something not-brand.
 */
export function gradientAt(t: number): string {
  const x = Math.min(Math.max(t, 0), 1);
  if (x <= OFFSETS[0]) return STOPS[0];
  if (x >= OFFSETS[OFFSETS.length - 1]) return STOPS[STOPS.length - 1];
  for (let i = 0; i < OFFSETS.length - 1; i++) {
    if (x >= OFFSETS[i] && x <= OFFSETS[i + 1]) {
      const span = OFFSETS[i + 1] - OFFSETS[i];
      return mix(STOPS[i], STOPS[i + 1], span === 0 ? 0 : (x - OFFSETS[i]) / span);
    }
  }
  return STOPS[STOPS.length - 1];
}

export interface TimeSpan {
  min: number;
  max: number;
}

/** Build the corpus time span once; undated entries are excluded. */
export function spanOf(dates: (Date | null)[]): TimeSpan {
  const t = dates.filter(Boolean).map((d) => (d as Date).getTime());
  if (t.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...t);
  const max = Math.max(...t);
  return { min, max: max === min ? min + 1 : max };
}

/** Where a date falls in the corpus, 0 (oldest) → 1 (newest). */
export function positionIn(span: TimeSpan, date: Date | null): number {
  if (!date) return 1;
  return (date.getTime() - span.min) / (span.max - span.min);
}

/** Convenience: the brand color for a given date. */
export function colorFor(span: TimeSpan, date: Date | null): string {
  return gradientAt(positionIn(span, date));
}
