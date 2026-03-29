"use client";

import { useState, useMemo, useEffect } from "react";
import { PrecalcMetrics, PrecalcCandidate, PortfolioPrecalc, RankedCandidate, FrameworkConfig } from "@/lib/api";
import type { Framework } from "@/lib/AppContext";

const OUTLOOKS      = ["Bearish", "Neutral", "Bullish"] as const;
const RISK_LEVELS   = ["Conservative", "Moderate", "Aggressive"] as const;
const GOALS         = ["Growth", "Balanced", "Income"] as const;
const HORIZONS      = [1, 2, 3] as const;

// Fallback constants used when no framework config is loaded yet
const NOTE_TYPES_GROWTH = new Set(["Growth", "Digital", "Absolute", "Snowball"]);
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
  const wIncome = goal === "Income" ? 0.5 : goal === "Growth" ? 0.0 : 0.1;
  return (
    1.0 * (cand.sharpe  - base.sharpe)
    - 1.0 * (cand.pct_neg - base.pct_neg)
    - 0.5 * (cand.shorty  - base.shorty)
    - 0.5 * ((cand.downside_kurt ?? 0) - (base.downside_kurt ?? 0))
    + wIncome * cand.income_boost
  );
}

interface Props {
  portfolioNames:  string[];
  initialFramework: Framework;
  precalcData:     Record<string, PortfolioPrecalc>;
  precalcLoading:  boolean;
  precalcStatus?:  string;
  frameworkConfig: FrameworkConfig | null;
  onContinue:      (framework: Framework) => void;
  onFrontier?:     (framework: Framework) => void;
}

export default function Screen4Analysis({
  portfolioNames,
  initialFramework,
  precalcData,
  precalcLoading,
  precalcStatus,
  frameworkConfig,
  onContinue,
  onFrontier,
}: Props) {
  const [outlook,   setOutlook]  = useState<string>(initialFramework.outlook  || "Neutral");
  const [risk,      setRisk]     = useState<string>(initialFramework.risk_tolerance || "Moderate");
  const [goal,      setGoal]     = useState<string>(initialFramework.goal     || "Balanced");
  const [horizon,   setHorizon]  = useState<number>(initialFramework.horizon  || 1);
  const [portName,  setPortName] = useState<string>(
    initialFramework.portfolio_name || portfolioNames[0] || ""
  );
  const [minAlloc,  setMinAlloc] = useState<number>(5);   // % e.g. 5 = 5%
  const [maxAlloc,  setMaxAlloc] = useState<number>(30);  // % e.g. 30 = 30%

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
    const minAllocFrac = minAlloc / 100;
    const maxAllocFrac = maxAlloc / 100;
    const scored: RankedCandidate[] = [];
    for (const c of candidates) {
      // Always apply the user's allocation range slider (overrides cell max)
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
        note_id:       c.note_id,
        note_type:     c.note_type,
        alloc_pct:     c.alloc_pct,
        sharpe:        c.metrics.sharpe,
        pct_neg:       c.metrics.pct_neg,
        shorty:        c.metrics.shorty,
        downside_kurt: c.metrics.downside_kurt ?? 0,
        mean:          c.metrics.mean ?? 0,
        std:           c.metrics.std ?? 0,
        income_boost:  c.metrics.income_boost,
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
  }, [portName, outlook, risk, goal, horizon, minAlloc, maxAlloc, precalcData, frameworkConfig]);

  const RadioGroup = ({
    label, options, value, onChange,
  }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <p className="text-sm font-semibold text-slate-600 mb-2">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              value === o
                ? "bg-blue-700 text-white border-blue-700"
                : "bg-white text-slate-700 border-slate-300 hover:border-blue-400"
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
      <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-center">
        <div className="text-2xl font-bold text-blue-700">{value}</div>
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
    <div className="w-full space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Analysis Setup</h2>
          <p className="text-sm text-slate-500">Select a portfolio, configure your framework, and set note allocation limits. Results update instantly.</p>
        </div>

        {/* ── Step 1: Select Base Portfolio ───────────────────────────────── */}
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Step 1 — Select Base Portfolio</p>
          <p className="text-xs text-slate-400 mb-3">Metrics shown for the selected horizon. Choose one portfolio to analyse.</p>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            {portfolioNames.map((name) => {
              const m = precalcData[name]?._base?.[String(horizon)];
              const selected = portName === name;
              return (
                <button
                  key={name}
                  onClick={() => setPortName(name)}
                  className={`text-left rounded-xl border-2 p-3 transition-colors ${
                    selected
                      ? "border-blue-600 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-blue-300 hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? "border-blue-600 bg-blue-600" : "border-slate-300"}`}>
                      {selected && <div className="w-1.5 h-1.5 bg-white rounded-full" />}
                    </div>
                    <span className={`text-xs font-semibold leading-tight ${selected ? "text-blue-800" : "text-slate-700"}`}>{name}</span>
                  </div>
                  {m ? (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Exp. Return</div>
                        <div className={`text-sm font-bold tabular-nums ${selected ? "text-blue-700" : "text-slate-800"}`}>{(m.mean * 100).toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Std Dev</div>
                        <div className="text-sm font-bold tabular-nums text-slate-700">{(m.std * 100).toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">Sharpe</div>
                        <div className="text-xs font-semibold tabular-nums text-slate-600">{m.sharpe.toFixed(3)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 uppercase tracking-wide">% Neg</div>
                        <div className="text-xs font-semibold tabular-nums text-slate-600">{m.pct_neg.toFixed(1)}%</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">No data</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Step 2: Framework Selection ──────────────────────────────────── */}
        <div>
          <p className="text-sm font-semibold text-slate-700 mb-3">Step 2 — Framework &amp; Horizon</p>
          <div className="space-y-4">
            <RadioGroup label="Market Outlook"   options={OUTLOOKS}    value={outlook} onChange={setOutlook} />
            <RadioGroup label="Risk Tolerance"   options={RISK_LEVELS} value={risk}    onChange={setRisk} />
            <RadioGroup label="Portfolio Goal"   options={GOALS}       value={goal}    onChange={setGoal} />
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Simulation Horizon</p>
              <div className="flex gap-2">
                {HORIZONS.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHorizon(h)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      horizon === h
                        ? "bg-blue-700 text-white border-blue-700"
                        : "bg-white text-slate-700 border-slate-300 hover:border-blue-400"
                    }`}
                  >
                    {h} {h === 1 ? "Year" : "Years"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Step 3: Note Allocation Range ────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-slate-700">Step 3 — Note Allocation Range</p>
            <span className="text-sm font-semibold text-blue-700 tabular-nums">{minAlloc}% – {maxAlloc}%</span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {[5, 10, 15, 20, 25, 30, 35, 40].map((s) => {
              const isMin     = s === minAlloc;
              const isMax     = s === maxAlloc;
              const inRange   = s > minAlloc && s < maxAlloc;
              const isEndpoint = isMin || isMax;
              return (
                <button
                  key={s}
                  onClick={() => {
                    if (s <= minAlloc) { setMinAlloc(s); }
                    else if (s >= maxAlloc) { setMaxAlloc(s); }
                    else {
                      // Within range — snap to nearest endpoint
                      if (s - minAlloc <= maxAlloc - s) setMinAlloc(s);
                      else setMaxAlloc(s);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
                    isEndpoint
                      ? "bg-blue-700 text-white border-blue-700"
                      : inRange
                      ? "bg-blue-100 text-blue-700 border-blue-300"
                      : "bg-white text-slate-400 border-slate-200 hover:border-slate-400 hover:text-slate-600"
                  }`}
                >
                  {s}%
                  {isMin && <span className="ml-1 text-[10px] opacity-70">min</span>}
                  {isMax && <span className="ml-1 text-[10px] opacity-70">max</span>}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-slate-400 mt-2">Click a step to set the min or max. Steps between are highlighted in blue.</p>
        </div>
      </div>

      {/* Loading spinner */}
      {precalcLoading && (
        <div className="flex flex-col items-center justify-center py-10 text-slate-500 gap-3">
          <div className="flex items-center gap-3">
            <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
            {precalcStatus || "Loading pre-computed data…"}
          </div>
        </div>
      )}

      {/* No data for this portfolio */}
      {noData && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-4 text-sm">
          No pre-calc data available for <strong>{portName}</strong>.
          Go back to Step 3 and re-save the portfolio to trigger pre-calculation.
        </div>
      )}

      {/* Base metrics */}
      {baseMetrics && !precalcLoading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-800">Base Portfolio — {horizon}yr Horizon</h3>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
            <MetricCard label="Exp. Return"      value={`${(baseMetrics.mean * 100).toFixed(2)}%`} />
            <MetricCard label="Std Dev"          value={`${(baseMetrics.std * 100).toFixed(2)}%`} />
            <MetricCard label="Sharpe Ratio"     value={baseMetrics.sharpe.toFixed(4)} />
            <MetricCard label="% Negative"       value={`${baseMetrics.pct_neg.toFixed(2)}%`} />
            <MetricCard label="Shorty"           value={baseMetrics.shorty.toFixed(4)} />
            <MetricCard label="D. Kurt."         value={(baseMetrics.downside_kurt ?? 0).toFixed(4)} />
            <MetricCard label="Expected Income"  value={`${baseMetrics.expected_income_pct.toFixed(2)}%`} />
          </div>
        </div>
      )}

      {/* Top-5 results */}
      {baseMetrics && !precalcLoading && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
            <span className="font-semibold text-slate-700">
              {ranked.length > 0
                ? `Top ${ranked.length} Candidate${ranked.length > 1 ? "s" : ""} — ${outlook} / ${goal} / ${risk}`
                : "No candidates under current framework"}
            </span>
            <span className="text-xs text-slate-400">Updates instantly</span>
          </div>

          {ranked.length === 0 ? (
            <div className="px-5 py-6 text-sm text-slate-500 text-center">
              No notes pass the current framework filters. Try changing the outlook, goal, or risk tolerance.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-500">Rank</th>
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-500">Note ID</th>
                    <th className="px-4 py-3 text-left text-xs uppercase font-semibold text-slate-500">Type</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">Alloc %</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">New Sharpe</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">New %Neg</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">New Shorty</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">New D.Kurt</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">Exp. Return</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">Std Dev</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">Exp. Income</th>
                    <th className="px-4 py-3 text-right text-xs uppercase font-semibold text-slate-500">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, idx) => {
                    const sharpeDelta  = r.sharpe  - baseMetrics.sharpe;
                    const pctNegDelta  = r.pct_neg - baseMetrics.pct_neg;
                    const shortyDelta  = r.shorty  - baseMetrics.shorty;
                    const dkurtDelta   = (r.downside_kurt ?? 0) - (baseMetrics.downside_kurt ?? 0);
                    return (
                      <tr key={r.note_id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-bold text-blue-700">#{idx + 1}</td>
                        <td className="px-4 py-3 font-mono font-semibold text-slate-800">{r.note_id}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${NOTE_TYPE_COLORS[r.note_type] ?? "bg-slate-100 text-slate-700"}`}>
                            {r.note_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{Math.round(r.alloc_pct * 100)}%</td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {r.sharpe.toFixed(4)}
                          <span className={`ml-1 text-xs ${sharpeDelta >= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({sharpeDelta >= 0 ? "+" : ""}{sharpeDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {r.pct_neg.toFixed(2)}%
                          <span className={`ml-1 text-xs ${pctNegDelta <= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({pctNegDelta >= 0 ? "+" : ""}{pctNegDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {r.shorty.toFixed(4)}
                          <span className={`ml-1 text-xs ${shortyDelta <= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({shortyDelta >= 0 ? "+" : ""}{shortyDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {(r.downside_kurt ?? 0).toFixed(4)}
                          <span className={`ml-1 text-xs ${dkurtDelta <= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({dkurtDelta >= 0 ? "+" : ""}{dkurtDelta.toFixed(4)})
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {((r.mean ?? 0) * 100).toFixed(2)}%
                          <span className={`ml-1 text-xs ${(r.mean - baseMetrics.mean) >= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({(r.mean - baseMetrics.mean) >= 0 ? "+" : ""}{((r.mean - baseMetrics.mean) * 100).toFixed(2)}%)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {((r.std ?? 0) * 100).toFixed(2)}%
                          <span className={`ml-1 text-xs ${(r.std - baseMetrics.std) <= 0 ? "text-green-600" : "text-red-500"}`}>
                            ({(r.std - baseMetrics.std) >= 0 ? "+" : ""}{((r.std - baseMetrics.std) * 100).toFixed(2)}%)
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {(() => {
                            const newIncome = baseMetrics.expected_income_pct + r.income_boost * 100;
                            const delta     = r.income_boost * 100;
                            return (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="text-slate-800 font-medium tabular-nums">{newIncome.toFixed(2)}%</span>
                                {Math.abs(delta) > 0.0001 && (
                                  <span className={`text-xs font-semibold tabular-nums ${delta > 0 ? "text-green-600" : "text-red-500"}`}>
                                    {delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(2)}%
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{r.score.toFixed(4)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Continue buttons */}
      {baseMetrics && !precalcLoading && (
        <div className="flex justify-end gap-3">
          {onFrontier && (
            <button
              onClick={() => onFrontier({ outlook, risk_tolerance: risk, goal, portfolio_name: portName, horizon })}
              className="border-2 border-blue-700 text-blue-700 hover:bg-blue-50 font-semibold py-2.5 px-6 rounded-lg transition-colors"
            >
              View Frontier →
            </button>
          )}
          <button
            onClick={() => onContinue({ outlook, risk_tolerance: risk, goal, portfolio_name: portName, horizon })}
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
          >
            View Histograms →
          </button>
        </div>
      )}
    </div>
  );
}
