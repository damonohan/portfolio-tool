"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api, EfficientFrontierData, EfficientFrontierNotePoint, Improvement } from "@/lib/api";
import dynamic from "next/dynamic";
import ImprovementDetail from "./ImprovementDetail";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

const NOTE_TYPE_COLORS: Record<string, string> = {
  Income:   "#3B82F6",
  Growth:   "#10B981",
  Digital:  "#8B5CF6",
  Absolute: "#F59E0B",
  MLCD:     "#14B8A6",
  PPN:      "#14B8A6",
  Snowball: "#F43F5E",
};

interface Framework {
  outlook: string;
  risk_tolerance: string;
  goal: string;
  portfolio_name: string;
  horizon: number;
}

interface ScreenProps {
  framework?: Framework;
}

export default function ScreenEfficientFrontier({ framework }: ScreenProps = {}) {
  const [data, setData] = useState<EfficientFrontierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBases, setSelectedBases] = useState<Set<string>>(new Set());
  const [selectedAllocs, setSelectedAllocs] = useState<Set<number>>(new Set());

  // Detail overlay state
  const [detailIdx, setDetailIdx] = useState<number | null>(null);
  const [detailImprovement, setDetailImprovement] = useState<Improvement | null>(null);
  const [detailBaseMetrics, setDetailBaseMetrics] = useState<{sharpe:number;pct_neg:number;shorty:number;expected_income_pct:number} | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getEfficientFrontier("Neutral")
      .then((d) => {
        setData(d);
        setSelectedBases(new Set(d.base_points.map((p) => p.portfolio)));
        // Default: all allocation percentages selected
        const allocs = new Set(d.note_points.map((p) => p.alloc_pct));
        (d.note_frontier ?? []).forEach((p) => allocs.add(p.alloc_pct));
        setSelectedAllocs(allocs);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  // All base portfolio names for the checkbox list
  const allBaseNames = useMemo(() => {
    if (!data) return [];
    return [...data.base_points].sort((a, b) => a.std - b.std).map((p) => p.portfolio);
  }, [data]);

  const toggleBase = (name: string) => {
    setSelectedBases((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        // Don't allow deselecting all
        if (next.size > 1) next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const selectAll = () => setSelectedBases(new Set(allBaseNames));
  const selectNone = () => {
    if (allBaseNames.length > 0) setSelectedBases(new Set([allBaseNames[0]]));
  };

  // All unique allocation percentages, sorted ascending
  const allAllocPcts = useMemo(() => {
    if (!data) return [];
    const s = new Set<number>();
    data.note_points.forEach((p) => s.add(p.alloc_pct));
    (data.note_frontier ?? []).forEach((p) => s.add(p.alloc_pct));
    return [...s].sort((a, b) => a - b);
  }, [data]);

  const toggleAlloc = (pct: number) => {
    setSelectedAllocs((prev) => {
      const next = new Set(prev);
      if (next.has(pct)) {
        if (next.size > 1) next.delete(pct);
      } else {
        next.add(pct);
      }
      return next;
    });
  };

  const selectAllAllocs = () => setSelectedAllocs(new Set(allAllocPcts));
  const selectNoneAllocs = () => {
    if (allAllocPcts.length > 0) setSelectedAllocs(new Set([allAllocPcts[0]]));
  };

  // Filtered data based on selected base portfolios AND allocation percentages
  const filteredNotePoints = useMemo(() => {
    if (!data) return [];
    return data.note_points.filter(
      (p) => selectedBases.has(p.portfolio) && selectedAllocs.has(p.alloc_pct)
    );
  }, [data, selectedBases, selectedAllocs]);

  // Open ImprovementDetail for a frontier row
  const handleViewDetail = useCallback(async (portfolioName: string, noteId: string) => {
    if (!framework) return;
    setDetailLoading(true);
    try {
      const res = await api.findImprovements({
        portfolio_name: portfolioName,
        outlook: framework.outlook,
        risk_tolerance: framework.risk_tolerance,
        goal: framework.goal,
        horizon: framework.horizon,
        ensure_note_id: noteId,
      });
      // Find the matching note in the improvements list
      const idx = res.improvements.findIndex((imp) => imp.note_id === noteId);
      if (idx >= 0) {
        setDetailBaseMetrics(res.base);
        setDetailImprovement(res.improvements[idx]);
        setDetailIdx(idx);
      }
    } catch (e) {
      console.error("Failed to load improvement detail", e);
    } finally {
      setDetailLoading(false);
    }
  }, [framework]);

  // Recompute Pareto frontier from filtered points (same logic as backend)
  const filteredFrontier = useMemo(() => {
    if (filteredNotePoints.length === 0) return [];
    const sorted = [...filteredNotePoints].sort((a, b) => a.std - b.std);
    const frontier: EfficientFrontierNotePoint[] = [];
    let maxMean = -Infinity;
    for (const pt of sorted) {
      if (pt.mean > maxMean) {
        frontier.push(pt);
        maxMean = pt.mean;
      }
    }
    return frontier;
  }, [filteredNotePoints]);

  const plotData = useMemo(() => {
    if (!data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traces: any[] = [];

    // Base portfolio frontier line — only selected, sort by std
    const sorted = [...data.base_points]
      .filter((p) => selectedBases.has(p.portfolio))
      .sort((a, b) => a.std - b.std);
    if (sorted.length > 0) {
      traces.push({
        x: sorted.map((p) => p.std),
        y: sorted.map((p) => p.mean),
        text: sorted.map((p) => p.portfolio),
        name: "Base Portfolios",
        mode: "lines+markers",
        type: "scatter",
        marker: { color: "#FFD700", size: 12, symbol: "diamond", line: { color: "#FFD700", width: 2 } },
        line: { color: "#FFD700", width: 2, dash: "solid" },
        hovertemplate: "<b>%{text}</b><br>Return: %{y:.2f}%<br>Risk: %{x:.2f}%<extra></extra>",
      });
    }

    // Note candidates — only for selected base portfolios, group by note_type
    const byType: Record<string, EfficientFrontierNotePoint[]> = {};
    for (const p of filteredNotePoints) {
      const onFrontier = filteredFrontier.some(
        (f) => f.note_id === p.note_id && f.portfolio === p.portfolio
      );
      if (onFrontier) continue;
      (byType[p.note_type] ??= []).push(p);
    }

    for (const [noteType, points] of Object.entries(byType)) {
      const color = NOTE_TYPE_COLORS[noteType] || "#6b7fa0";
      traces.push({
        x: points.map((p) => p.std),
        y: points.map((p) => p.mean),
        text: points.map((p) => `${p.portfolio} + ${p.note_type}: ${p.underlier} @ ${p.alloc_pct}%`),
        name: noteType,
        mode: "markers",
        type: "scatter",
        marker: {
          color: color,
          size: 8,
          opacity: 0.45,
          line: { color: color, width: 1 },
        },
        hovertemplate: "<b>%{text}</b><br>Return: %{y:.2f}%<br>Risk: %{x:.2f}%<extra></extra>",
      });
    }

    // Note-enhanced frontier line — only selected
    if (filteredFrontier.length > 0) {
      const frontier = [...filteredFrontier].sort((a, b) => a.std - b.std);
      traces.push({
        x: frontier.map((p) => p.std),
        y: frontier.map((p) => p.mean),
        text: frontier.map((p) => `${p.portfolio} + ${p.note_type}: ${p.underlier} @ ${p.alloc_pct}%`),
        name: "Note-Enhanced Frontier",
        mode: "lines+markers",
        type: "scatter",
        marker: {
          color: frontier.map((p) => NOTE_TYPE_COLORS[p.note_type] || "#00e5c8"),
          size: 14,
          symbol: "star",
          line: { color: "#00e5c8", width: 1.5 },
        },
        line: { color: "#00e5c8", width: 2.5, dash: "dash" },
        hovertemplate: "<b>%{text}</b><br>Return: %{y:.2f}%<br>Risk: %{x:.2f}%<extra></extra>",
      });
    }

    return traces;
  }, [data, selectedBases, filteredNotePoints, filteredFrontier]);

  const layout = useMemo(() => ({
    paper_bgcolor: "transparent",
    plot_bgcolor: "transparent",
    font: { family: "DM Mono, monospace", color: "#6b7fa0", size: 11 },
    xaxis: {
      title: { text: "Annualized Volatility (%)", font: { size: 12, color: "#6b7fa0" } },
      gridcolor: "rgba(255,255,255,0.05)",
      tickfont: { family: "DM Mono", size: 10, color: "#6b7fa0" },
      zeroline: false,
    },
    yaxis: {
      title: { text: "Annualized Return (%)", font: { size: 12, color: "#6b7fa0" } },
      gridcolor: "rgba(255,255,255,0.05)",
      tickfont: { family: "DM Mono", size: 10, color: "#6b7fa0" },
      zeroline: false,
    },
    legend: {
      bgcolor: "rgba(15,26,46,0.85)",
      bordercolor: "rgba(255,255,255,0.1)",
      borderwidth: 1,
      font: { family: "DM Sans", size: 12, color: "#F0F4FF" },
      x: 0.01,
      y: 0.99,
    },
    margin: { l: 60, r: 30, t: 20, b: 60 },
    autosize: true,
    hovermode: "closest" as const,
  }), []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-slate-200 rounded-lg" />
          <div className="h-[500px] bg-slate-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <>
    {/* ImprovementDetail overlay */}
    {detailIdx !== null && detailBaseMetrics && detailImprovement && (
      <ImprovementDetail
        index={detailIdx}
        improvement={detailImprovement}
        baseMetrics={detailBaseMetrics}
        onClose={() => { setDetailIdx(null); setDetailImprovement(null); setDetailBaseMetrics(null); }}
      />
    )}

    {/* Loading overlay for detail fetch */}
    {detailLoading && (
      <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center">
        <div className="bg-white rounded-xl px-6 py-4 shadow-lg text-sm font-medium text-slate-700">
          Loading analysis...
        </div>
      </div>
    )}

    <div className="max-w-6xl mx-auto space-y-4">
      {/* Base portfolio filter checkboxes */}
      {allBaseNames.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">Filter by Base Portfolio</span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Select All
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={selectNone}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {allBaseNames.map((name) => (
              <label
                key={name}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={selectedBases.has(name)}
                  onChange={() => toggleBase(name)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600
                             focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className={`text-sm transition-colors ${
                  selectedBases.has(name)
                    ? "text-slate-800 font-medium"
                    : "text-slate-400"
                } group-hover:text-slate-700`}>
                  {name}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {selectedBases.size} of {allBaseNames.length} selected
          </div>
        </div>
      )}

      {/* Allocation percentage filter checkboxes */}
      {allAllocPcts.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">Filter by Allocation %</span>
            <div className="flex gap-2">
              <button
                onClick={selectAllAllocs}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Select All
              </button>
              <span className="text-slate-300">|</span>
              <button
                onClick={selectNoneAllocs}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                Clear
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {allAllocPcts.map((pct) => (
              <label
                key={pct}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={selectedAllocs.has(pct)}
                  onChange={() => toggleAlloc(pct)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600
                             focus:ring-blue-500 focus:ring-offset-0 cursor-pointer"
                />
                <span className={`text-sm transition-colors ${
                  selectedAllocs.has(pct)
                    ? "text-slate-800 font-medium"
                    : "text-slate-400"
                } group-hover:text-slate-700`}>
                  {pct}%
                </span>
              </label>
            ))}
          </div>
          <div className="mt-2 text-xs text-slate-400">
            {selectedAllocs.size} of {allAllocPcts.length} selected
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h3 className="text-lg font-bold text-slate-800 mb-1">Efficient Frontier</h3>
        <p className="text-sm text-slate-500 mb-4">
          2-year horizon — base portfolios (gold line) vs note-enhanced frontier (teal dashed) vs all note combinations (faded dots)
        </p>
        <div style={{ height: 520 }}>
          <Plot
            data={plotData}
            layout={layout}
            style={{ width: "100%", height: "100%" }}
            config={{ displayModeBar: false, responsive: true }}
            useResizeHandler={true}
          />
        </div>
      </div>

      {/* Note-enhanced frontier table — filtered */}
      {filteredFrontier.length > 0 && (
        <FrontierTable points={filteredFrontier} onView={framework ? handleViewDetail : undefined} />
      )}

      {data && (
        <div className="text-xs text-slate-400 px-2">
          {selectedBases.size} base portfolio{selectedBases.size !== 1 ? "s" : ""} selected · {filteredNotePoints.length} note combinations · {filteredFrontier.length} on enhanced frontier
        </div>
      )}
    </div>
    </>
  );
}

function FrontierTable({ points, onView }: { points: EfficientFrontierNotePoint[]; onView?: (portfolioName: string, noteId: string) => void }) {
  const sorted = [...points].sort((a, b) => a.std - b.std);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
        <span className="font-semibold text-slate-700">
          Note-Enhanced Efficient Frontier — {sorted.length} Portfolio{sorted.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-slate-400 ml-2">
          Best return for each risk level when adding a structured note
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">#</th>
              <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Portfolio</th>
              <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Note</th>
              <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Type</th>
              <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Alloc %</th>
              <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Return (%)</th>
              <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Risk (%)</th>
              {onView && <th className="px-4 py-3 bg-slate-50 text-slate-500 text-xs uppercase"></th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((pt, idx) => (
              <tr
                key={`${pt.portfolio}-${pt.note_id}-${pt.alloc_pct}-${idx}`}
                className="border-b border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-3 font-bold text-blue-700">#{idx + 1}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{pt.portfolio}</td>
                <td className="px-4 py-3 font-mono text-slate-600 text-xs">{pt.underlier || pt.note_id}</td>
                <td className="px-4 py-3">
                  <span
                    className="px-2 py-0.5 rounded text-xs font-semibold"
                    style={{
                      backgroundColor: `${NOTE_TYPE_COLORS[pt.note_type] || "#6b7fa0"}20`,
                      color: NOTE_TYPE_COLORS[pt.note_type] || "#6b7fa0",
                    }}
                  >
                    {pt.note_type}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-800">{pt.alloc_pct}%</td>
                <td className="px-4 py-3 text-right font-mono text-green-600 font-semibold">{pt.mean.toFixed(2)}%</td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{pt.std.toFixed(2)}%</td>
                {onView && (
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => onView(pt.portfolio, pt.note_id)}
                      className="px-3 py-1 text-xs font-medium text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 transition-colors"
                    >
                      View
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
