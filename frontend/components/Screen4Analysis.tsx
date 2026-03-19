"use client";

import { useState, useMemo, useEffect } from "react";
import { PrecalcMetrics, PrecalcCandidate, PortfolioPrecalc, RankedCandidate, FrameworkConfig } from "@/lib/api";
import type { Framework } from "@/app/page";

const OUTLOOKS      = ["Bearish", "Neutral", "Bullish"] as const;
const RISK_LEVELS   = ["Conservative", "Moderate", "Aggressive"] as const;
const GOALS         = ["Growth", "Balanced", "Income"] as const;
const HORIZONS      = [1, 2, 3] as const;

// Fallback constants used when no framework config is loaded yet
const NOTE_TYPES_GROWTH = new Set(["Growth", "Digital", "Absolute"]);
const NOTE_TYPES_INCOME = new Set(["Income", "MLCD", "PPN"]);

const RISK_MAX_FALLBACK: Record<string, number> = {
  Conservative: 0.175,
  Moderate:     0.275,
  Aggressive:   0.375,
};

function rankScore(
  base: PrecalcMetrics,
  cand: PrecalcCandidate["metrics"],
  goal: string
): number {
  const wIncome = goal === "Income" ? 0.5 : 0.1;
  return (
    1.0 * (cand.sharpe  - base.sharpe)
    - 1.0 * (cand.pct_neg - base.pct_neg)
    - 0.5 * (cand.shorty  - base.shorty)
    + wIncome * cand.income_boost
  );
}

interface Props {
  portfolioNames:  string[];
  initialFramework: Framework;
  precalcData:     Record<string, PortfolioPrecalc>;
  precalcLoading:  boolean;
  frameworkConfig: FrameworkConfig | null;
  onContinue:      (framework: Framework) => void;
}

export default function Screen4Analysis({
  portfolioNames,
  initialFramework,
  precalcData,
  precalcLoading,
  frameworkConfig,
  onContinue,
}: Props) {
  const [outlook,  setOutlook]  = useState<string>(initialFramework.outlook  || "Neutral");
  const [risk,     setRisk]     = useState<string>(initialFramework.risk_tolerance || "Moderate");
  const [goal,     setGoal]     = useState<string>(initialFramework.goal     || "Balanced");
  const [horizon,  setHorizon]  = useState<number>(initialFramework.horizon  || 1);
  const [portName, setPortName] = useState<string>(
    initialFramework.portfolio_name || portfolioNames[0] || ""
  );

  useEffect(() => {
    if (portfolioNames.length > 0 && !portName) setPortName(portfolioNames[0]);
  }, [portfolioNames, portName]);

  // ── Client-side filtering and ranking ────────────────────────────────────────
  const { baseMetrics, ranked } = useMemo<{
    baseMetrics: PrecalcMetrics | null;
    ranked: RankedCandidate[];
  }>(() => {
    if (!portName || !outlook || !goal || !risk) return { baseMetrics: null, ranked: [] };
    const portData = precalcData[portName];
    if (!portData) return { baseMetrics: null, ranked: [] };

    const hKey        = String(horizon);
    const base        = portData._base?.[hKey];
    const candidates  = portData[outlook as "Bullish" | "Bearish" | "Neutral"]?.[hKey] ?? [];

    if (!base) return { baseMetrics: null, ranked: [] };

    // 27-cell config lookup — falls back to hardcoded behaviour when config not loaded yet
    const cellKey  = `${outlook}|${risk}|${goal}`;
    const cell     = frameworkConfig?.cells[cellKey];

    // Fallback values (used only when cell config is unavailable)
    const riskMaxFallback  = RISK_MAX_FALLBACK[risk] ?? 0.275;
    const allowedTypesFallback = goal === "Growth" ? NOTE_TYPES_GROWTH
                               : goal === "Income" ? NOTE_TYPES_INCOME
                               : new Set([...NOTE_TYPES_GROWTH, ...NOTE_TYPES_INCOME]);

    // Filter + score
    const scored: RankedCandidate[] = [];
    for (const c of candidates) {
      if (cell) {
        // ── Apply 27-cell framework config ──────────────────────────────
        if (c.alloc_pct > cell.max_alloc_pct / 100 + 1e-9) continue;
        if (cell.allowed_types.length > 0 && !cell.allowed_types.includes(c.note_type)) continue;
        if (cell.allowed_underlyings.length > 0 && !cell.allowed_underlyings.includes(c.underlier)) continue;
        if (cell.allowed_protection_types.length > 0 && !cell.allowed_protection_types.includes(c.protection_type)) continue;
        if (c.protection_pct < cell.min_protection_pct) continue;
        if (c.protection_pct > cell.max_protection_pct) continue;
      } else {
        // ── Fallback hardcoded filter ────────────────────────────────────
        if (c.alloc_pct > riskMaxFallback + 1e-9) continue;
        if (!allowedTypesFallback.has(c.note_type)) continue;
      }
      const score = rankScore(base, c.metrics, goal);
      scored.push({
        note_id:      c.note_id,
        note_type:    c.note_type,
        alloc_pct:    c.alloc_pct,
        sharpe:       c.metrics.sharpe,
        pct_neg:      c.metrics.pct_neg,
        shorty:       c.metrics.shorty,
        income_boost: c.metrics.income_boost,
        score,
      });
    }

    // Sort descending, deduplicate by note_id, take top 5
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
  }, [portName, outlook, risk, goal, horizon, precalcData, frameworkConfig]);

  const RadioGroup = ({
    label, options, value, onChange,
  }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <p className="text-sm font-semibold text-slate-300 mb-2">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              value === o
                ? "bg-teal-600 text-white border-teal-600"
                : "bg-[#0f1629] text-slate-300 border-slate-600 hover:border-teal-500"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  const MetricCard = ({ label, value, delta, lowerBetter }: {
    label: string; value: string; delta?: number; lowerBetter?: boolean;
  }) => {
    const good = delta === undefined ? undefined : (lowerBetter ? delta <= 0 : delta >= 0);
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
        <div className="text-2xl font-bold text-slate-800">{value}</div>
        <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wide">{label}</div>
        {delta !== undefined && (
          <div className={`text-xs mt-0.5 font-semibold ${good ? "text-green-600" : "text-red-500"}`}>
            {delta >= 0 ? "+" : ""}{delta.toFixed(4)}
          </div>
        )}
      </div>
    );
  };

  const NOTE_TYPE_COLORS: Record<string, string> = {
    Income:   "bg-green-100 text-green-700",
    Growth:   "bg-blue-100 text-blue-700",
    Digital:  "bg-purple-100 text-purple-700",
    Absolute: "bg-slate-100 text-slate-700",
    MLCD:     "bg-teal-100 text-teal-700",
    PPN:      "bg-teal-100 text-teal-700",
  };

  const noData = !precalcLoading && portName && !precalcData[portName];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-[#1a2035] rounded-xl border border-slate-700 p-6 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-slate-100 mb-1">Framework Selection</h2>
          <p className="text-sm text-slate-400">
            Results update instantly as you change selections below.
          </p>
        </div>

        <RadioGroup label="Market Outlook" options={OUTLOOKS} value={outlook} onChange={setOutlook} />
        <RadioGroup label="Risk Tolerance" options={RISK_LEVELS} value={risk} onChange={setRisk} />
        <RadioGroup label="Portfolio Goal" options={GOALS} value={goal} onChange={setGoal} />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-300 mb-2">Simulation Horizon</p>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-[#0f1629] text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{h} {h === 1 ? "Year" : "Years"}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-300 mb-2">Starting Portfolio</p>
            <select
              value={portName}
              onChange={(e) => setPortName(e.target.value)}
              className="w-full border border-slate-600 rounded-lg px-3 py-2 text-sm bg-[#0f1629] text-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {portfolioNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Loading spinner */}
      {precalcLoading && (
        <div className="flex items-center justify-center py-10 text-slate-400 gap-3">
          <div className="animate-spin w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full" />
          Loading pre-computed data…
        </div>
      )}

      {/* No data for this portfolio */}
      {noData && (
        <div className="bg-amber-900/30 border border-amber-700 text-amber-300 rounded-xl px-5 py-4 text-sm">
          No pre-calc data available for <strong>{portName}</strong>.
          Go back to Step 3 and re-save the portfolio to trigger pre-calculation.
        </div>
      )}

      {/* Base metrics */}
      {baseMetrics && !precalcLoading && (
        <div className="bg-[#1a2035] rounded-xl border border-slate-700 p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-100">Base Portfolio — {horizon}yr Horizon</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Sharpe Ratio"     value={baseMetrics.sharpe.toFixed(4)} />
            <MetricCard label="% Negative"       value={`${baseMetrics.pct_neg.toFixed(2)}%`} />
            <MetricCard label="Shorty"           value={baseMetrics.shorty.toFixed(4)} />
            <MetricCard label="Expected Income"  value={`${baseMetrics.expected_income_pct.toFixed(2)}%`} />
          </div>
          <div className="flex gap-4 text-sm text-slate-400">
            <span>Mean return: <strong className="text-slate-100">{(baseMetrics.mean * 100).toFixed(2)}%</strong></span>
            <span>Std dev: <strong className="text-slate-100">{(baseMetrics.std * 100).toFixed(2)}%</strong></span>
          </div>
        </div>
      )}

      {/* Top-5 results */}
      {baseMetrics && !precalcLoading && (
        <div className="bg-[#1a2035] rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700 bg-[#0f1629] flex items-center justify-between">
            <span className="font-semibold text-slate-300">
              {ranked.length > 0
                ? `Top ${ranked.length} Candidate${ranked.length > 1 ? "s" : ""} — ${outlook} / ${goal} / ${risk}`
                : "No candidates under current framework"}
            </span>
            <span className="text-xs text-slate-500">Updates instantly</span>
          </div>

          {ranked.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-400 text-center">
              No notes pass the current framework filters. Try changing the outlook, goal, or risk tolerance.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-[#0f1629]">
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-400">Rank</th>
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-400">Note ID</th>
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-400">Type</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">Alloc %</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">New Sharpe</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">New %Neg</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">New Shorty</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">Income Boost</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-400">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, idx) => {
                    const sharpeDelta  = r.sharpe  - baseMetrics.sharpe;
                    const pctNegDelta  = r.pct_neg - baseMetrics.pct_neg;
                    const shortyDelta  = r.shorty  - baseMetrics.shorty;
                    return (
                      <tr key={r.note_id} className="border-b border-slate-700/50 hover:bg-[#232b45] transition-colors">
                        <td className="px-4 py-3 font-bold text-teal-400">#{idx + 1}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-200">{r.note_id}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${NOTE_TYPE_COLORS[r.note_type] ?? "bg-slate-100 text-slate-700"}`}>
                            {r.note_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-300">{Math.round(r.alloc_pct * 100)}%</td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {r.sharpe.toFixed(4)}
                          <span className={`ml-1 text-xs ${sharpeDelta >= 0 ? "text-green-500" : "text-red-500"}`}>
                            ({sharpeDelta >= 0 ? "+" : ""}{sharpeDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {r.pct_neg.toFixed(2)}%
                          <span className={`ml-1 text-xs ${pctNegDelta <= 0 ? "text-green-500" : "text-red-500"}`}>
                            ({pctNegDelta >= 0 ? "+" : ""}{pctNegDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300">
                          {r.shorty.toFixed(4)}
                          <span className={`ml-1 text-xs ${shortyDelta <= 0 ? "text-green-500" : "text-red-500"}`}>
                            ({shortyDelta >= 0 ? "+" : ""}{shortyDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.income_boost > 0
                            ? <span className="text-green-500 font-semibold">+{(r.income_boost * 100).toFixed(4)}%</span>
                            : <span className="text-slate-500">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-400">{r.score.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Continue button */}
      {baseMetrics && !precalcLoading && (
        <div className="flex justify-end">
          <button
            onClick={() => onContinue({ outlook, risk_tolerance: risk, goal, portfolio_name: portName, horizon })}
            className="bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
          >
            View Histograms →
          </button>
        </div>
      )}
    </div>
  );
}
