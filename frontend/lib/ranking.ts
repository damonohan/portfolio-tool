import { PrecalcMetrics, PrecalcCandidate, PortfolioPrecalc, RankedCandidate, FrameworkConfig } from "@/lib/api";

const NOTE_TYPES_GROWTH = new Set(["Growth", "Digital", "Absolute", "Snowball"]);
const NOTE_TYPES_INCOME = new Set(["Income", "MLCD", "PPN"]);

export function rankScore(
  base: PrecalcMetrics,
  cand: PrecalcCandidate["metrics"],
  goal: string
): number {
  const wIncome = goal === "Income" ? 0.5 : goal === "Growth" ? 0.0 : 0.1;
  return (
    1.0 * (cand.sharpe - base.sharpe)
    - 1.0 * (cand.pct_neg - base.pct_neg)
    - 0.5 * (cand.shorty - base.shorty)
    - 0.5 * ((cand.downside_kurt ?? 0) - (base.downside_kurt ?? 0))
    + wIncome * cand.income_boost
  );
}

export function computeRankedCandidates(opts: {
  portName: string;
  outlook: string;
  risk: string;
  goal: string;
  horizon: number;
  minAlloc: number;
  maxAlloc: number;
  precalcData: Record<string, PortfolioPrecalc>;
  frameworkConfig: FrameworkConfig | null;
}): { baseMetrics: PrecalcMetrics | null; ranked: RankedCandidate[] } {
  const { portName, outlook, risk, goal, horizon, minAlloc, maxAlloc, precalcData, frameworkConfig } = opts;

  if (!portName || !outlook || !goal || !risk) return { baseMetrics: null, ranked: [] };
  const portData = precalcData[portName];
  if (!portData) return { baseMetrics: null, ranked: [] };

  const hKey = String(horizon);
  const base = portData._base?.[hKey] as PrecalcMetrics | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates = ((portData as any)[outlook] as Record<string, PrecalcCandidate[]> | undefined)?.[hKey] ?? [];

  if (!base) return { baseMetrics: null, ranked: [] };

  // 27-cell config lookup
  const cellKey = `${outlook}|${risk}|${goal}`;
  const cell = frameworkConfig?.cells[cellKey];

  // Fallback values
  const allowedTypesFallback = goal === "Growth" ? NOTE_TYPES_GROWTH
    : goal === "Income" ? NOTE_TYPES_INCOME
    : new Set([...NOTE_TYPES_GROWTH, ...NOTE_TYPES_INCOME]);

  const minAllocFrac = minAlloc / 100;
  const maxAllocFrac = maxAlloc / 100;
  const scored: RankedCandidate[] = [];

  for (const c of candidates) {
    if (c.alloc_pct < minAllocFrac - 1e-9) continue;
    if (c.alloc_pct > maxAllocFrac + 1e-9) continue;
    if (cell) {
      if (cell.allowed_types.length > 0 && !cell.allowed_types.includes(c.note_type)) continue;
      if (cell.allowed_underlyings.length > 0 && !cell.allowed_underlyings.includes(c.underlier)) continue;
      if (cell.allowed_protection_types.length > 0 && !cell.allowed_protection_types.includes(c.protection_type)) continue;
      if (c.protection_pct < cell.min_protection_pct) continue;
      if (c.protection_pct > cell.max_protection_pct) continue;
    } else {
      if (!allowedTypesFallback.has(c.note_type)) continue;
    }
    const score = rankScore(base, c.metrics, goal);
    scored.push({
      note_id: c.note_id,
      note_type: c.note_type,
      alloc_pct: c.alloc_pct,
      sharpe: c.metrics.sharpe,
      pct_neg: c.metrics.pct_neg,
      shorty: c.metrics.shorty,
      downside_kurt: c.metrics.downside_kurt ?? 0,
      mean: c.metrics.mean ?? 0,
      std: c.metrics.std ?? 0,
      income_boost: c.metrics.income_boost,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const top5: RankedCandidate[] = [];
  for (const c of scored) {
    if (!seen.has(c.note_id)) {
      seen.add(c.note_id);
      top5.push(c);
    }
    if (top5.length === 5) break;
  }

  return { baseMetrics: base, ranked: top5 };
}
