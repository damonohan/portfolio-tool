"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAppContext } from "@/lib/AppContext";
import { api, EfficientFrontierData, EfficientFrontierNotePoint } from "@/lib/api";
import {
  Chart as ChartJS,
  LinearScale, PointElement, LineElement, Tooltip, Legend, Filler,
} from "chart.js";
import { Scatter } from "react-chartjs-2";

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const NOTE_TYPE_COLORS: Record<string, { fill: string; hover: string; border: string; solid: string }> = {
  Growth:   { fill: "rgba(102,187,106,0.38)", hover: "rgba(102,187,106,0.92)", border: "rgba(102,187,106,0.15)", solid: "#66bb6a" },
  Income:   { fill: "rgba(79,195,247,0.38)",  hover: "rgba(79,195,247,0.92)",  border: "rgba(79,195,247,0.15)",  solid: "#4fc3f7" },
  Digital:  { fill: "rgba(171,71,188,0.38)",   hover: "rgba(171,71,188,0.92)",  border: "rgba(171,71,188,0.15)",  solid: "#ab47bc" },
  Absolute: { fill: "rgba(255,167,38,0.38)",   hover: "rgba(255,167,38,0.92)",  border: "rgba(255,167,38,0.15)",  solid: "#ffa726" },
  MLCD:     { fill: "rgba(38,198,218,0.38)",   hover: "rgba(38,198,218,0.92)",  border: "rgba(38,198,218,0.15)",  solid: "#14b8a6" },
  PPN:      { fill: "rgba(38,198,218,0.38)",   hover: "rgba(38,198,218,0.92)",  border: "rgba(38,198,218,0.15)",  solid: "#14b8a6" },
  Snowball: { fill: "rgba(239,83,80,0.38)",    hover: "rgba(239,83,80,0.92)",   border: "rgba(239,83,80,0.15)",   solid: "#f43f5e" },
};

const DEFAULT_TYPE_COLORS = { fill: "rgba(107,127,160,0.38)", hover: "rgba(107,127,160,0.92)", border: "rgba(107,127,160,0.15)", solid: "#6b7fa0" };

// Jitter to prevent exact stacking
const jitter = () => (Math.random() - 0.5) * 0.1;

// Chart.js plugin: light background inside plot area
const chartAreaBgPlugin = {
  id: "chartAreaBg",
  beforeDraw(chart: ChartJS) {
    const ctx = chart.ctx;
    const { left, top, width, height } = chart.chartArea ?? {};
    if (!width || !height) return;
    ctx.save();
    ctx.fillStyle = "#f8f9fb";
    ctx.fillRect(left, top, width, height);
    ctx.restore();
  },
};

export default function FrontierPage() {
  const { framework, sessionLoaded, portfolioNames } = useAppContext();
  const [data, setData] = useState<EfficientFrontierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedBases, setSelectedBases] = useState<Set<string>>(new Set());
  const [selectedAllocs, setSelectedAllocs] = useState<Set<number>>(new Set());
  const [selectedPoint, setSelectedPoint] = useState<EfficientFrontierNotePoint | null>(null);

  useEffect(() => {
    if (!sessionLoaded) return;
    setLoading(true);
    api.getEfficientFrontier(framework.outlook || "Neutral")
      .then((d) => {
        setData(d);
        setSelectedBases(new Set(d.base_points.map(p => p.portfolio)));
        const allocs = new Set<number>();
        d.note_points.forEach(p => allocs.add(p.alloc_pct));
        (d.note_frontier ?? []).forEach(p => allocs.add(p.alloc_pct));
        setSelectedAllocs(allocs);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [sessionLoaded, framework.outlook]);

  // All base portfolio names
  const allBaseNames = useMemo(() => {
    if (!data) return [];
    return [...data.base_points].sort((a, b) => a.std - b.std).map(p => p.portfolio);
  }, [data]);

  // All unique allocation percentages
  const allAllocPcts = useMemo(() => {
    if (!data) return [];
    const s = new Set<number>();
    data.note_points.forEach(p => s.add(p.alloc_pct));
    (data.note_frontier ?? []).forEach(p => s.add(p.alloc_pct));
    return [...s].sort((a, b) => a - b);
  }, [data]);

  const toggleBase = (name: string) => {
    setSelectedBases(prev => {
      const next = new Set(prev);
      if (next.has(name)) { if (next.size > 1) next.delete(name); }
      else next.add(name);
      return next;
    });
  };

  const toggleAlloc = (pct: number) => {
    setSelectedAllocs(prev => {
      const next = new Set(prev);
      if (next.has(pct)) { if (next.size > 1) next.delete(pct); }
      else next.add(pct);
      return next;
    });
  };

  const filteredNotePoints = useMemo(() => {
    if (!data) return [];
    let pts = data.note_points.filter(
      p => selectedBases.has(p.portfolio) && selectedAllocs.has(p.alloc_pct)
    );
    if (typeFilter !== "all") pts = pts.filter(p => p.note_type === typeFilter);
    return pts;
  }, [data, selectedBases, selectedAllocs, typeFilter]);

  const filteredFrontier = useMemo(() => {
    if (filteredNotePoints.length === 0) return [];
    const sorted = [...filteredNotePoints].sort((a, b) => a.std - b.std);
    const frontier: EfficientFrontierNotePoint[] = [];
    let maxMean = -Infinity;
    for (const pt of sorted) {
      if (pt.mean > maxMean) { frontier.push(pt); maxMean = pt.mean; }
    }
    return frontier;
  }, [filteredNotePoints]);

  const noteTypes = useMemo(() => {
    if (!data) return [];
    const s = new Set(data.note_points.map(p => p.note_type));
    return [...s].sort();
  }, [data]);

  const sortedCandidates = useMemo(() => {
    return [...filteredFrontier].sort((a, b) => b.mean - a.mean);
  }, [filteredFrontier]);

  if (!sessionLoaded || loading) {
    return <div style={{ padding: "80px 0", textAlign: "center", color: "var(--text-muted)" }}>Loading frontier data...</div>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
        <div className="halo-card" style={{ padding: 40 }}>
          <p style={{ color: "var(--accent-red)", marginBottom: 16 }}>{error}</p>
          <Link href="/analysis" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontWeight: 600 }}>← Back to Analysis</Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Build Chart.js datasets — 3-layer system
  const frontierSet = new Set(filteredFrontier.map(p => `${p.portfolio}:${p.note_id}:${p.alloc_pct}`));

  // Group ALL candidates by note_type (including frontier points for click lookup)
  const byType: Record<string, EfficientFrontierNotePoint[]> = {};
  const byTypeNonFrontier: Record<string, EfficientFrontierNotePoint[]> = {};
  for (const p of filteredNotePoints) {
    (byType[p.note_type] ??= []).push(p);
    if (!frontierSet.has(`${p.portfolio}:${p.note_id}:${p.alloc_pct}`)) {
      (byTypeNonFrontier[p.note_type] ??= []).push(p);
    }
  }

  // Filtered base points
  const visibleBasePoints = data.base_points.filter(p => selectedBases.has(p.portfolio));

  // Layer 1 — Candidate cloud: separate dataset per note type (order 10 = background)
  const candidateDatasets = Object.entries(byTypeNonFrontier).map(([noteType, points]) => {
    const colors = NOTE_TYPE_COLORS[noteType] ?? DEFAULT_TYPE_COLORS;
    return {
      label: noteType,
      data: points.map(p => ({ x: p.std + jitter(), y: p.mean + jitter(), name: `${p.portfolio} + ${p.note_type}: ${p.underlier}`, alloc: p.alloc_pct, type: p.note_type })),
      backgroundColor: colors.fill,
      borderColor: colors.border,
      borderWidth: 1,
      pointRadius: 4,
      pointHoverRadius: 8,
      pointHoverBackgroundColor: colors.hover,
      order: 10,
    };
  });

  // Layer 2 — Base portfolio frontier (order 2 = middle)
  const baseDataset = {
    label: "Base Portfolios",
    data: [...visibleBasePoints].sort((a, b) => a.std - b.std).map(p => ({ x: p.std, y: p.mean, name: p.portfolio })),
    backgroundColor: "#ffd54f",
    borderColor: "rgba(255,213,79,0.7)",
    borderWidth: 2,
    pointStyle: "rectRot" as const,
    pointRadius: 8,
    pointBorderColor: "#f9a825",
    pointBorderWidth: 2,
    pointHoverRadius: 11,
    showLine: true,
    tension: 0.3,
    fill: false,
    order: 2,
  };

  // Layer 3 — Note-enhanced Pareto frontier (order 1 = top)
  const sortedFrontier = [...filteredFrontier].sort((a, b) => a.std - b.std);
  const paretoDataset = {
    label: "Note-Enhanced Frontier",
    data: sortedFrontier.map(p => ({ x: p.std, y: p.mean, name: `${p.note_type}: ${p.underlier} @${p.alloc_pct}%`, alloc: p.alloc_pct, type: p.note_type })),
    backgroundColor: "#00B7CD",
    borderColor: "rgba(0,183,205,0.7)",
    borderWidth: 2.5,
    segment: { borderDash: [8, 4] as [number, number] },
    pointStyle: "star" as const,
    pointRadius: 10,
    pointBorderColor: "#00838f",
    pointBorderWidth: 2,
    pointHoverRadius: 13,
    showLine: true,
    tension: 0.3,
    fill: false,
    order: 1,
  };

  const chartData = {
    datasets: [
      ...candidateDatasets,  // Layer 1 (background)
      baseDataset,           // Layer 2 (middle)
      paretoDataset,         // Layer 3 (top)
    ],
  };

  // Auto-zoom: compute scale bounds when type filter is active
  const autoZoom = typeFilter !== "all";
  let xMin: number | undefined, xMax: number | undefined, yMin: number | undefined, yMax: number | undefined;
  if (autoZoom) {
    const allVisible = [
      ...filteredNotePoints.map(p => ({ x: p.std, y: p.mean })),
      ...visibleBasePoints.map(p => ({ x: p.std, y: p.mean })),
    ];
    if (allVisible.length > 0) {
      const pad = 0.5;
      xMin = Math.min(...allVisible.map(p => p.x)) - pad;
      xMax = Math.max(...allVisible.map(p => p.x)) + pad;
      yMin = Math.min(...allVisible.map(p => p.y)) - pad;
      yMax = Math.max(...allVisible.map(p => p.y)) + pad;
    }
  }

  // Dataset index map for click handling
  const typeKeys = Object.keys(byTypeNonFrontier);
  const baseIdx = candidateDatasets.length;
  const paretoIdx = candidateDatasets.length + 1;

  return (
    <div>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 24px",
        background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/analysis" style={{
            background: "none", border: "1px solid var(--border)", color: "var(--text-secondary)",
            padding: "6px 14px", borderRadius: 6, textDecoration: "none", fontSize: 13,
          }}>← Back to Analysis</Link>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Efficient Frontier</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {framework.risk_tolerance} {framework.goal} &middot; {framework.outlook} &middot; {framework.horizon}yr Horizon
          </span>
        </div>
      </div>

      {/* Layout: chart + sidebar */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 380px",
        gap: 20, padding: "20px 24px", maxWidth: 1500, margin: "0 auto",
      }}>
        {/* Left: chart area */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Insight */}
          <div className="insight-banner">
            <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>📈</span>
            <div className="insight-text">
              <strong>{filteredNotePoints.length} candidates</strong> evaluated. The Pareto frontier shows{" "}
              <strong>{filteredFrontier.length} dominant candidates</strong> — no other candidate improves on both axes simultaneously.
            </div>
          </div>

          {/* Filters row */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {/* Portfolio filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Portfolio:</span>
              {allBaseNames.map(name => {
                const active = selectedBases.has(name);
                return (
                  <button key={name} onClick={() => toggleBase(name)} style={{
                    padding: "4px 12px", borderRadius: 14, fontSize: 11, fontWeight: active ? 600 : 500,
                    cursor: "pointer", transition: "all 0.2s",
                    border: `1px solid ${active ? "var(--halo-cyan)" : "var(--border)"}`,
                    background: active ? "rgba(0,183,205,0.15)" : "transparent",
                    color: active ? "var(--halo-cyan)" : "var(--text-secondary)",
                  }}>{name}</button>
                );
              })}
              <button onClick={() => setSelectedBases(new Set(allBaseNames))} style={{
                padding: "3px 8px", borderRadius: 10, fontSize: 10, cursor: "pointer",
                border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)",
              }}>All</button>
            </div>

            {/* Allocation filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Alloc %:</span>
              {allAllocPcts.map(pct => {
                const active = selectedAllocs.has(pct);
                return (
                  <button key={pct} onClick={() => toggleAlloc(pct)} style={{
                    padding: "4px 12px", borderRadius: 14, fontSize: 11, fontWeight: active ? 600 : 500,
                    cursor: "pointer", transition: "all 0.2s",
                    border: `1px solid ${active ? "var(--halo-cyan)" : "var(--border)"}`,
                    background: active ? "rgba(0,183,205,0.15)" : "transparent",
                    color: active ? "var(--halo-cyan)" : "var(--text-secondary)",
                  }}>{pct}%</button>
                );
              })}
              <button onClick={() => setSelectedAllocs(new Set(allAllocPcts))} style={{
                padding: "3px 8px", borderRadius: 10, fontSize: 10, cursor: "pointer",
                border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)",
              }}>All</button>
            </div>

            {/* Type filter */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>Note type:</span>
              {["all", ...noteTypes].map(t => {
                const active = typeFilter === t;
                const dotColor = t !== "all" ? (NOTE_TYPE_COLORS[t] ?? DEFAULT_TYPE_COLORS).solid : undefined;
                return (
                  <button key={t} onClick={() => setTypeFilter(t)} style={{
                    padding: "4px 14px", borderRadius: 14, fontSize: 11, fontWeight: active ? 600 : 500,
                    cursor: "pointer", transition: "all 0.2s",
                    border: `1px solid ${active ? "var(--halo-cyan)" : "var(--border)"}`,
                    background: active ? "rgba(0,183,205,0.15)" : "transparent",
                    color: active ? "var(--halo-cyan)" : "var(--text-secondary)",
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    {dotColor && <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
                    {t === "all" ? "All" : t}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chart */}
          <div style={{ background: "var(--bg-card)", borderRadius: 12, padding: 24, border: "1px solid var(--border)" }}>
            <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--text-primary)", marginBottom: 4, fontWeight: 700 }}>
              Risk–Return Frontier
            </h3>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
              Each dot is a candidate. Starred candidates form the Pareto-optimal frontier.
            </div>
            <div style={{ position: "relative", height: 480 }}>
              <Scatter
                data={chartData}
                plugins={[chartAreaBgPlugin]}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  onClick: (_event, elements) => {
                    if (elements.length > 0) {
                      const el = elements[0];
                      const dsIdx = el.datasetIndex;
                      if (dsIdx === baseIdx) return; // base click — ignore
                      if (dsIdx === paretoIdx) {
                        setSelectedPoint(sortedFrontier[el.index]);
                      } else if (dsIdx < candidateDatasets.length) {
                        const noteType = typeKeys[dsIdx];
                        const pts = byTypeNonFrontier[noteType];
                        if (pts?.[el.index]) setSelectedPoint(pts[el.index]);
                      }
                    }
                  },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      backgroundColor: "rgba(15,25,35,0.95)",
                      titleColor: "#e8edf2",
                      bodyColor: "#8899aa",
                      padding: 12,
                      cornerRadius: 8,
                      titleFont: { size: 13, weight: "bold" },
                      callbacks: {
                        title: (items) => {
                          const item = items[0];
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const pt = item.raw as any;
                          return pt?.name || item.dataset.label || "";
                        },
                        label: (item) => {
                          // eslint-disable-next-line @typescript-eslint/no-explicit-any
                          const pt = item.raw as any;
                          const lines = [
                            `Annualized Volatility: ${(item.parsed.x ?? 0).toFixed(2)}%`,
                            `Annualized Return: ${(item.parsed.y ?? 0).toFixed(2)}%`,
                          ];
                          if (pt?.alloc) lines.push(`Allocation: ${pt.alloc}%`);
                          if (pt?.type) lines.push(`Type: ${pt.type}`);
                          return lines;
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      title: { display: true, text: "Annualized Volatility (%)", color: "#6b7b8d" },
                      ticks: { color: "#6b7b8d" },
                      grid: { color: "rgba(0,0,0,0.06)" },
                      ...(autoZoom && xMin !== undefined ? { min: xMin, max: xMax } : {}),
                    },
                    y: {
                      title: { display: true, text: "Annualized Return (%)", color: "#6b7b8d" },
                      ticks: { color: "#6b7b8d" },
                      grid: { color: "rgba(0,0,0,0.06)" },
                      ...(autoZoom && yMin !== undefined ? { min: yMin, max: yMax } : {}),
                    },
                  },
                }}
              />
            </div>
            {/* Legend */}
            <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6b7b8d" }}>
                <div style={{ width: 10, height: 10, transform: "rotate(45deg)", background: "#ffd54f", border: "2px solid #f9a825" }} /> Base Portfolios
              </div>
              {noteTypes.map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6b7b8d" }}>
                  <div style={{ width: 10, height: 10, borderRadius: "50%", background: (NOTE_TYPE_COLORS[t] ?? DEFAULT_TYPE_COLORS).solid }} /> {t}
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6b7b8d" }}>
                <svg width="14" height="14" viewBox="0 0 14 14"><polygon points="7,0 9,5 14,5 10,8.5 11.5,14 7,10.5 2.5,14 4,8.5 0,5 5,5" fill="#00B7CD" stroke="#00838f" strokeWidth="1" /></svg>
                <span style={{ borderBottom: "2px dashed rgba(0,183,205,0.7)", paddingBottom: 1 }}>Note-Enhanced Frontier</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Candidate list */}
          <div className="halo-card" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div className="section-label">
              Top Candidates <span style={{ color: "var(--text-muted)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>★ = Pareto optimal</span>
            </div>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {sortedCandidates.length === 0 && (
                <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: 20 }}>No frontier candidates</p>
              )}
              {sortedCandidates.map((c, i) => {
                const isPareto = frontierSet.has(`${c.portfolio}:${c.note_id}:${c.alloc_pct}`);
                const isSelected = selectedPoint && selectedPoint.note_id === c.note_id && selectedPoint.portfolio === c.portfolio && selectedPoint.alloc_pct === c.alloc_pct;
                const typeCol = (NOTE_TYPE_COLORS[c.note_type] ?? DEFAULT_TYPE_COLORS).solid;
                return (
                  <div
                    key={`${c.portfolio}-${c.note_id}-${c.alloc_pct}`}
                    onClick={() => setSelectedPoint(c)}
                    style={{
                      padding: "10px 12px", borderRadius: 10, cursor: "pointer",
                      border: `1px solid ${isSelected ? "var(--halo-cyan)" : "transparent"}`,
                      background: isSelected ? "rgba(0,183,205,0.08)" : "transparent",
                      transition: "all 0.2s", marginBottom: 6, position: "relative",
                    }}
                  >
                    {isPareto && <span style={{ position: "absolute", top: 8, right: 10, color: "var(--accent-gold)", fontSize: 14 }}>★</span>}
                    <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>
                      #{i + 1} &middot; {c.portfolio}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: typeCol, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{c.note_type}: {c.underlier}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6 }}>
                      {c.alloc_pct}% alloc
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                      {[
                        { label: "Return", value: `${c.mean.toFixed(2)}%` },
                        { label: "Risk", value: `${c.std.toFixed(2)}%` },
                        { label: "Alloc", value: `${c.alloc_pct}%` },
                      ].map(m => (
                        <div key={m.label} style={{ background: "rgba(255,255,255,0.04)", borderRadius: 6, padding: "4px 6px", textAlign: "center" }}>
                          <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{m.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected candidate detail */}
          <div className="halo-card">
            <div className="section-label">Selected Candidate</div>
            {!selectedPoint ? (
              <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "20px 0" }}>
                Click a candidate to see full metrics
              </p>
            ) : (
              <div>
                <div style={{ marginBottom: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      display: "inline-block", padding: "2px 10px", borderRadius: 10,
                      fontSize: 11, fontWeight: 600,
                      background: (NOTE_TYPE_COLORS[selectedPoint.note_type] ?? DEFAULT_TYPE_COLORS).solid + "26",
                      color: (NOTE_TYPE_COLORS[selectedPoint.note_type] ?? DEFAULT_TYPE_COLORS).solid,
                    }}>{selectedPoint.note_type}</span>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{selectedPoint.underlier}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                    {selectedPoint.portfolio} &middot; {selectedPoint.alloc_pct}% alloc
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                  {[
                    { label: "Exp. Return", value: `${selectedPoint.mean.toFixed(2)}%` },
                    { label: "Std Dev", value: `${selectedPoint.std.toFixed(2)}%` },
                    { label: "Note Type", value: selectedPoint.note_type },
                    { label: "Alloc", value: `${selectedPoint.alloc_pct}%` },
                  ].map(m => (
                    <div key={m.label} style={{ background: "#ffffff", borderRadius: 10, padding: "12px 14px", border: "1px solid #e2e8f0" }}>
                      <div style={{ fontSize: 11, color: "var(--halo-navy)", fontWeight: 700, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "#1a2a3a" }}>{m.value}</div>
                    </div>
                  ))}
                </div>
                <Link
                  href={`/histogram/0`}
                  style={{
                    display: "block", width: "100%", padding: 12, border: "none", borderRadius: 10,
                    background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
                    color: "#fff", fontSize: 14, fontWeight: 600, textAlign: "center",
                    textDecoration: "none", transition: "all 0.2s",
                  }}
                >
                  View Histogram Detail →
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
