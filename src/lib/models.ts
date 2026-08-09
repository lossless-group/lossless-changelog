/**
 * Which model was doing the work, and when.
 *
 * 310 of 393 entries record an `augmented_with` value, and the strings are
 * gloriously inconsistent — "Claude Code on Claude Opus 4.7 (1M context)",
 * "Claude Code (Opus 4.7)", "Claude Opus 4.5", "Claude". They are hand-typed
 * at the end of a working session, so normalization is the whole job here.
 *
 * The point is not tool trivia. This corpus is largely one person working at
 * the edge of agentic engineering, so "which model, when" is the most
 * informative dimension the metadata carries: the band under the ledger reads
 * as a record of the frontier moving.
 */

export interface ModelUse {
  /** Display label, e.g. "Opus 4.7". */
  label: string;
  /** Family for grouping and colour: opus | sonnet | fable | haiku | other. */
  family: string;
  /** Numeric version for ordering within a family; 0 when unstated. */
  version: number;
}

const FAMILIES = ["opus", "sonnet", "fable", "haiku"] as const;

/**
 * Pull a model out of a free-text augmentation string.
 * Returns undefined for values that name no model ("Claude" alone, tool names
 * with no model, empty strings) rather than guessing.
 */
export function normalizeModel(raw: string): ModelUse | undefined {
  if (!raw) return undefined;
  const s = raw.toLowerCase();

  const family = FAMILIES.find((f) => s.includes(f));
  if (!family) return undefined;

  // Version follows the family name: "opus 4.7", "opus 5", "sonnet 4.6".
  const m = s.match(new RegExp(`${family}\\s*[-v]?\\s*(\\d+(?:\\.\\d+)?)`));
  const version = m ? parseFloat(m[1]) : 0;

  const pretty = family[0].toUpperCase() + family.slice(1);
  return {
    label: version ? `${pretty} ${m![1]}` : pretty,
    family,
    version,
  };
}

/** First model found across an entry's augmentation strings. */
export function modelFor(augmentedWith: string[]): ModelUse | undefined {
  for (const a of augmentedWith) {
    const m = normalizeModel(a);
    if (m) return m;
  }
  return undefined;
}

export interface ModelEra {
  label: string;
  family: string;
  version: number;
  /** Bounds across entries that named this model. */
  from: Date;
  to: Date;
  count: number;
}

/**
 * Build the era timeline: for each distinct model, the span of entries that
 * used it and how many. Sorted by first appearance, which is the order the
 * frontier actually moved.
 */
export function erasFrom(entries: { date: Date | null; augmentedWith: string[] }[]): ModelEra[] {
  const acc = new Map<string, ModelEra>();

  for (const e of entries) {
    if (!e.date) continue;
    const m = modelFor(e.augmentedWith);
    if (!m) continue;

    const cur = acc.get(m.label);
    if (cur) {
      cur.count += 1;
      if (e.date < cur.from) cur.from = e.date;
      if (e.date > cur.to) cur.to = e.date;
    } else {
      acc.set(m.label, { ...m, from: e.date, to: e.date, count: 1 });
    }
  }

  return [...acc.values()].sort((a, b) => a.from.getTime() - b.from.getTime());
}

/**
 * The dominant model for each week — what you were mostly using then.
 * Weeks with no augmented entries are omitted rather than interpolated; a gap
 * in the band means "no record", not "no model".
 */
export function weeklyDominant(
  entries: { date: Date | null; augmentedWith: string[] }[],
): { week: number; label: string; family: string; n: number }[] {
  const weeks = new Map<number, Map<string, { n: number; family: string }>>();

  for (const e of entries) {
    if (!e.date) continue;
    const m = modelFor(e.augmentedWith);
    if (!m) continue;
    const d = e.date;
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000;
    const week = day - (d.getUTCDay() % 7) * 86_400;

    if (!weeks.has(week)) weeks.set(week, new Map());
    const bucket = weeks.get(week)!;
    const cur = bucket.get(m.label);
    if (cur) cur.n += 1;
    else bucket.set(m.label, { n: 1, family: m.family });
  }

  return [...weeks.entries()]
    .map(([week, bucket]) => {
      let best = { label: "", n: 0, family: "" };
      for (const [label, v] of bucket) {
        // Ties break toward the later-sorting label, which for our naming is
        // the higher version — the frontier, not the trailing edge.
        if (v.n > best.n || (v.n === best.n && label > best.label)) {
          best = { label, n: v.n, family: v.family };
        }
      }
      return { week, label: best.label, family: best.family, n: best.n };
    })
    .sort((a, b) => a.week - b.week);
}

/** Share of entries that recorded any augmentation at all. */
export function augmentationRate(entries: { augmentedWith: string[]; authors: string[] }[]) {
  const withAny = entries.filter(
    (e) => e.augmentedWith.length > 0 || e.authors.some((a) => /claude|gpt|cursor|copilot/i.test(a)),
  ).length;
  return { withAny, total: entries.length, pct: Math.round((withAny / entries.length) * 100) };
}
