"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { api, ImprovementDetail as DetailData, Improvement } from "@/lib/api";
import dynamic from "next/dynamic";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });
const ResponsiveBar = dynamic(
  () => import("@nivo/bar").then((m) => m.ResponsiveBar),
  { ssr: false }
);

interface BaseMetrics {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  downside_kurt: number;
  expected_income_pct: number;
}

interface Props {
  index: number;
  improvement: Improvement;
  baseMetrics: BaseMetrics;
  onClose: () => void;
}

const NOTE_TYPE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Income:   { bg: "bg-amber-900/30",   text: "text-amber-300",  border: "border-amber-500/40" },
  Growth:   { bg: "bg-blue-900/30",    text: "text-blue-300",   border: "border-blue-500/40" },
  Digital:  { bg: "bg-purple-900/30",  text: "text-purple-300", border: "border-purple-500/40" },
  Absolute: { bg: "bg-slate-700/40",   text: "text-slate-300",  border: "border-slate-500/40" },
  Snowball: { bg: "bg-rose-900/30",    text: "text-rose-300",   border: "border-rose-500/40" },
  MLCD:     { bg: "bg-teal-900/30",    text: "text-teal-300",   border: "border-teal-500/40" },
  PPN:      { bg: "bg-orange-900/30",  text: "text-orange-300", border: "border-orange-500/40" },
};

// ── Slot machine number animation ───────────────────────────────────────────
function useSlotNumber(target: number, delay: number, duration = 800) {
  const [display, setDisplay] = useState(0);
  const [landed, setLanded] = useState(false);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    setLanded(false);
    const startTime = performance.now() + delay;
    const tick = (now: number) => {
      if (now < startTime) { rafRef.current = requestAnimationFrame(tick); return; }
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress < 1 ? 1 - Math.pow(1 - progress, 3) : 1;
      setDisplay(target * eased);
      if (progress < 1) rafRef.current = requestAnimationFrame(tick);
      else { setDisplay(target); setLanded(true); }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, delay, duration]);
  return { display, landed };
}

// ── MetricCard ───────────────────────────────────────────────────────────────
function MetricCard({
  label, before, after, format, lowerIsBetter, index: cardIndex,
}: {
  label: string; before: number; after: number; format: (v: number) => string;
  lowerIsBetter?: boolean; index: number;
}) {
  const diff = after - before;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const neutral  = Math.abs(diff) < 1e-6;

  const data = [
    { id: "Before", Before: before, After: 0 },
    { id: "After",  Before: 0,      After: after },
  ];

  return (
    <div
      className="bg-[#0F2035] rounded-xl border border-white/10 px-4 py-3 flex flex-col gap-2 shadow-[0_2px_12px_rgba(0,0,0,0.4)]"
      style={{ animation: `cardEntrance 350ms ease-out ${cardIndex * 60}ms both` }}
    >
      {/* Label + delta pill */}
      <div className="flex items-start justify-between gap-1">
        <span className="text-xs font-bold text-slate-300 leading-snug">{label}</span>
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 shrink-0 border ${
          neutral  ? "bg-slate-700 text-slate-400 border-slate-600"
          : improved ? "bg-emerald-400/15 text-emerald-400 border-emerald-400/30"
          :            "bg-red-400/15 text-red-400 border-red-400/30"
        }`}>
          {diff >= 0 ? "+" : ""}{format(diff)}
        </span>
      </div>

      {/* Before → After — equal size */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-bold tabular-nums text-slate-400 whitespace-nowrap">{format(before)}</span>
        <svg width="16" height="10" viewBox="0 0 20 12" fill="none" className="shrink-0">
          <line x1="0" y1="6" x2="16" y2="6" stroke="#475569" strokeWidth="1.5"/>
          <path d="M12 1L18 6L12 11" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className={`text-sm font-bold tabular-nums whitespace-nowrap ${
          neutral ? "text-slate-100" : improved ? "text-emerald-400" : "text-red-400"
        }`}>{format(after)}</span>
      </div>

      {/* Mini bar chart */}
      <div style={{ minHeight: 70 }}>
        <ResponsiveBar
          data={data}
          keys={["Before", "After"]}
          indexBy="id"
          groupMode="grouped"
          colors={["#334155", "#3B82F6"]}
          animate={true}
          motionConfig="gentle"
          borderRadius={3}
          padding={0.3}
          innerPadding={4}
          enableLabel={false}
          enableGridY={false}
          axisBottom={{ tickSize: 0, tickPadding: 5 }}
          axisLeft={null}
          margin={{ top: 4, right: 6, bottom: 20, left: 6 }}
          theme={{
            background: "transparent",
            axis: { ticks: { text: { fill: "#64748b", fontSize: 10 } } },
            grid: { line: { stroke: "rgba(255,255,255,0.05)" } },
            tooltip: { container: { background: "#162847", color: "#f1f5f9", fontSize: "12px", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.4)" } },
          }}
        />
      </div>
    </div>
  );
}

// ── Weight row ───────────────────────────────────────────────────────────────
function WeightRow({ asset, beforeW, afterW, isNote, rowIndex }: {
  asset: string; beforeW: number | undefined; afterW: number; isNote: boolean; rowIndex: number;
}) {
  const delta = isNote ? 0 : +((afterW) - (beforeW ?? 0)).toFixed(1);
  const { display: animAfter, landed } = useSlotNumber(afterW, rowIndex * 50 + 200);

  return (
    <div className={`flex items-center py-2 border-b border-white/5 last:border-0 ${
      isNote ? "rounded-lg bg-amber-400/10 border border-amber-400/20 px-2 -mx-2 my-1" : ""
    }`}>
      <span className={`flex-1 text-sm font-medium leading-tight pr-2 ${isNote ? "text-amber-300 font-semibold" : "text-slate-200"}`}>
        {asset}
      </span>
      <span className={`w-14 text-right text-xs tabular-nums shrink-0 ${isNote ? "text-slate-600" : "text-slate-500"}`}>
        {isNote ? "—" : `${(beforeW ?? 0).toFixed(1)}%`}
      </span>
      <span className="w-4 text-center text-slate-600 text-[9px] shrink-0">→</span>
      <span className={`w-14 text-right text-xs tabular-nums font-bold shrink-0 ${isNote ? "text-amber-300" : "text-slate-100"}`}>
        {animAfter.toFixed(1)}%
      </span>
      <span className="w-12 text-right shrink-0">
        {isNote ? (
          <span className="text-[9px] font-bold text-amber-300 bg-amber-400/15 border border-amber-400/30 px-1.5 py-0.5 rounded-full">NEW</span>
        ) : delta !== 0 ? (
          <span className={`text-[9px] tabular-nums rounded-full px-1.5 py-0.5 transition-opacity duration-300 ${
            landed ? "opacity-100" : "opacity-0"
          } ${delta < 0 ? "bg-red-400/15 text-red-400 border border-red-400/30" : "bg-emerald-400/15 text-emerald-400 border border-emerald-400/30"}`}>
            {delta > 0 ? "+" : ""}{delta}%
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ImprovementDetail({ index, onClose }: Props) {
  const [detail,  setDetail]  = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api.getImprovementDetail(index)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load detail"))
      .finally(() => setLoading(false));
  }, [index]);

  // Dark-themed histogram
  const styledHistogram = useMemo(() => {
    if (!detail) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (detail.histogram.data as any[]).map((trace: any, i: number) => ({
      ...trace,
      marker: {
        ...trace.marker,
        color: i === 0 ? "rgba(59,130,246,0.25)" : "rgba(196,151,58,0.25)",
        line:  { color: i === 0 ? "#3B82F6" : "#C4973A", width: 1.5 },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLayout = detail.histogram.layout as any;
    const layout = {
      ...rawLayout,
      paper_bgcolor: "#0F2035",
      plot_bgcolor:  "#0B1929",
      font: { family: "system-ui, sans-serif", color: "#94a3b8", size: 11 },
      xaxis: { ...rawLayout?.xaxis, gridcolor: "rgba(255,255,255,0.05)", tickfont: { size: 11, color: "#94a3b8" }, zerolinecolor: "rgba(255,255,255,0.15)" },
      yaxis: { ...rawLayout?.yaxis, gridcolor: "rgba(255,255,255,0.05)", tickfont: { size: 11, color: "#94a3b8" } },
      legend: { ...rawLayout?.legend, bgcolor: "rgba(15,32,53,0.95)", bordercolor: "rgba(255,255,255,0.1)", borderwidth: 1, font: { size: 12, color: "#e2e8f0" } },
      margin: { l: 52, r: 20, t: 30, b: 50 },
      shapes: (rawLayout?.shapes || []).map((s: Record<string, unknown>) => ({
        ...s, line: { ...(s.line as Record<string, unknown> || {}), color: "#ef4444", dash: "dot", width: 1.5 },
      })),
    };
    return { data, layout };
  }, [detail]);

  const globalStyles = (
    <style>{`
      @keyframes overlayIn   { from { opacity: 0; }                        to { opacity: 1; } }
      @keyframes cardEntrance { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    `}</style>
  );

  const backButton = (
    <button
      onClick={onClose}
      className="fixed top-5 left-5 z-[60] flex items-center gap-2 px-4 py-2 rounded-full bg-[#0F2035] border border-white/20 text-slate-300 hover:text-white hover:border-white/40 hover:shadow-md transition-all text-sm font-medium shadow-sm"
      style={{ animation: 'overlayIn 200ms ease-out both' }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Back
    </button>
  );

  if (loading) return (
    <div className="fixed inset-0 z-50 bg-[#0B1929] overflow-hidden" style={{ animation: 'overlayIn 200ms ease-out both' }}>
      {globalStyles}{backButton}
      <div className="max-w-[1400px] mx-auto px-6 pt-20 space-y-4">
        <div className="animate-pulse h-14 bg-[#162847] rounded-xl" />
        <div className="animate-pulse h-64 bg-[#162847] rounded-xl" />
      </div>
    </div>
  );

  if (error || !detail) return (
    <div className="fixed inset-0 z-50 bg-[#0B1929] overflow-hidden">
      {globalStyles}{backButton}
      <div className="max-w-[1400px] mx-auto px-6 pt-20">
        <div className="bg-red-900/20 border border-red-500/30 text-red-400 rounded-xl px-5 py-4 text-sm">{error || "No data."}</div>
      </div>
    </div>
  );

  const { base_weights, after_weights, base_metrics, after_metrics } = detail;
  const allAssets = Object.entries(after_weights).sort(([, a], [, b]) => b - a);
  const typeCls   = NOTE_TYPE_COLORS[detail.note_type] ?? NOTE_TYPE_COLORS.Absolute;
  const fmt2  = (v: number) => v.toFixed(2);
  const fmt4  = (v: number) => v.toFixed(4);
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;

  return (
    <div className="fixed inset-0 z-50 bg-[#0B1929] overflow-auto" style={{ animation: 'overlayIn 200ms ease-out both' }}>
      {globalStyles}{backButton}

      <div className="max-w-[1400px] mx-auto px-6 pt-16 pb-6 flex flex-col gap-4">

        {/* ── Note header ──────────────────────────────────────────────── */}
        <div
          className="bg-[#0F2035] rounded-xl border-l-4 border-l-amber-400 border border-white/10 shadow-sm px-5 py-3 flex flex-wrap items-center gap-4"
          style={{ animation: 'cardEntrance 300ms ease-out both' }}
        >
          <h2 className="text-xl font-bold text-white">
            {detail.note_type}: {detail.underlier}
          </h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ring-1 ring-white/10 ${typeCls.bg} ${typeCls.text} ${typeCls.border}`}>
            {detail.note_type}
          </span>
          <span className="text-sm font-mono text-amber-400">#{detail.note_id}</span>
          <span className="text-sm text-slate-400">Allocation: <strong className="text-white">{detail.alloc_pct}%</strong></span>
          {detail.protection_type && (
            <span className="text-sm text-slate-400">Protection: <strong className="text-white">{detail.protection_type} {detail.protection_pct > 0 ? `${detail.protection_pct}%` : ""}</strong></span>
          )}
        </div>

        {/* ── Middle row: weights + histogram ──────────────────────────── */}
        <div className="flex gap-4" style={{ minHeight: 380 }}>

          {/* Portfolio weights */}
          <div className="w-80 shrink-0 bg-[#0F2035] rounded-xl border border-white/10 shadow-sm flex flex-col overflow-hidden"
            style={{ animation: 'cardEntrance 300ms ease-out 60ms both' }}>
            <div className="px-4 py-2.5 border-b border-white/10 shrink-0 bg-[#162847]">
              <div className="flex text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <span className="flex-1">Asset</span>
                <span className="w-14 text-right text-blue-400/70">Before</span>
                <span className="w-4" />
                <span className="w-14 text-right text-slate-400">After</span>
                <span className="w-12 text-right">Δ</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-1">
              {allAssets.map(([asset, afterW], i) => (
                <WeightRow key={asset} asset={asset} beforeW={base_weights[asset]} afterW={afterW}
                  isNote={base_weights[asset] === undefined} rowIndex={i} />
              ))}
            </div>
          </div>

          {/* Histogram */}
          <div className="flex-1 bg-[#0F2035] rounded-xl border border-white/10 shadow-sm p-4 flex flex-col min-w-0"
            style={{ animation: 'cardEntrance 300ms ease-out 120ms both' }}>
            <p className="text-xs font-bold uppercase tracking-widest text-amber-400 border-l-2 border-amber-400 pl-3 mb-3 shrink-0">
              Return Distribution
            </p>
            <div className="flex-1 min-h-0">
              {styledHistogram && (
                <Plot
                  data={styledHistogram.data as Plotly.Data[]}
                  layout={{ ...styledHistogram.layout, autosize: true }}
                  style={{ width: "100%", height: "100%" }}
                  config={{ displayModeBar: false, responsive: true }}
                  useResizeHandler={true}
                />
              )}
            </div>
          </div>
        </div>

        {/* ── Full-width metrics ────────────────────────────────────────── */}
        <div style={{ animation: 'cardEntrance 300ms ease-out 180ms both' }}>
          <p className="text-xs font-bold uppercase tracking-widest text-amber-400 border-l-2 border-amber-400 pl-3 mb-3">
            Metrics Comparison — Base vs With Note
          </p>
          <div className="grid grid-cols-7 gap-3">
            <MetricCard label="Exp. Return"   before={base_metrics.mean}               after={after_metrics.mean}               format={fmtPct} index={0} />
            <MetricCard label="Std Dev"        before={base_metrics.std}                after={after_metrics.std}                format={fmtPct} lowerIsBetter index={1} />
            <MetricCard label="Sharpe Ratio"   before={base_metrics.sharpe}             after={after_metrics.sharpe}             format={fmt4} index={2} />
            <MetricCard label="% Negative"     before={base_metrics.pct_neg}            after={after_metrics.pct_neg}            format={fmt2} lowerIsBetter index={3} />
            <MetricCard label="Shorty"         before={base_metrics.shorty}             after={after_metrics.shorty}             format={fmt4} lowerIsBetter index={4} />
            <MetricCard label="D. Kurt."       before={base_metrics.downside_kurt ?? 0} after={after_metrics.downside_kurt ?? 0} format={fmt4} lowerIsBetter index={5} />
            <MetricCard label="Exp. Income"    before={base_metrics.expected_income_pct} after={after_metrics.expected_income_pct} format={fmtPct} index={6} />
          </div>
        </div>

      </div>
    </div>
  );
}
