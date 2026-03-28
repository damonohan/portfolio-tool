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

// Gold palette
const GOLD        = "#FFD700";
const GOLD_DIM    = "#D4A017";
const BLUE        = "#3B82F6";
const GREEN_POS   = "#00e676";
const RED_NEG     = "#ff4444";
const TEXT_MUTED   = "#6b7fa0";
const TEXT_LIGHT   = "#c0ccdf";
const CARD_BG      = "#1a2740";
const OVERLAY_BG   = "#0f1a2e";

const NOTE_TYPE_COLORS: Record<string, string> = {
  Income: `bg-[${GOLD}]/15 text-[${GOLD}] border-[${GOLD}]/30`,
  Growth: "bg-[#3B82F6]/15 text-[#3B82F6] border-[#3B82F6]/30",
  Digital: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  Absolute: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  Snowball: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  MLCD: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  PPN: "bg-orange-500/15 text-orange-400 border-orange-500/30",
};

// ── Slot machine number animation hook ──────────────────────────────────────
function useSlotNumber(target: number, delay: number, duration = 800) {
  const [display, setDisplay] = useState(0);
  const [landed, setLanded] = useState(false);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    setLanded(false);
    const startTime = performance.now() + delay;

    const tick = (now: number) => {
      if (now < startTime) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = progress < 1 ? 1 - Math.pow(1 - progress, 3) : 1;
      setDisplay(target * eased);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(target);
        setLanded(true);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, delay, duration]);

  return { display, landed };
}

// ── MetricCard ──────────────────────────────────────────────────────────────
function MetricCard({
  label, before, after, format, lowerIsBetter, index: cardIndex,
}: {
  label: string; before: number; after: number; format: (v: number) => string;
  lowerIsBetter?: boolean; index: number;
}) {
  const diff = after - before;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;

  const data = [
    { id: "Before", Before: before, After: 0 },
    { id: "After", Before: 0, After: after },
  ];

  return (
    <div
      className="rounded-xl border border-white/[0.08] px-4 py-4 flex flex-col gap-2 bg-[#1a2740] transition-all duration-300 hover:border-[#FFD700]/30 hover:shadow-[0_0_24px_rgba(255,215,0,0.08)] min-w-0"
      style={{ animation: `cardEntrance 400ms ease-out ${cardIndex * 80}ms both` }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="text-[10px] tracking-[0.14em] uppercase text-[#6b7fa0] font-['Syne'] truncate">{label}</span>
        <span className={`text-[11px] font-['DM_Mono'] rounded-full px-2 py-0.5 shrink-0 ${
          improved
            ? "bg-[#00e676]/15 text-[#00e676] border border-[#00e676]/30"
            : diff === 0
            ? "bg-white/5 text-[#6b7fa0] border border-white/10"
            : "bg-[#ff4444]/15 text-[#ff4444] border border-[#ff4444]/30"
        }`}>
          {diff >= 0 ? "+" : ""}{format(diff)}
        </span>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="text-sm font-['DM_Mono'] text-[#6b7fa0] tabular-nums whitespace-nowrap">{format(before)}</span>
        <svg width="16" height="10" viewBox="0 0 20 12" fill="none" className="shrink-0 relative top-[1px]">
          <line x1="0" y1="6" x2="16" y2="6" stroke="#FFD700" strokeOpacity="0.5" strokeWidth="1.5"/>
          <path d="M12 1L18 6L12 11" stroke="#FFD700" strokeOpacity="0.5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-xl font-['DM_Mono'] font-medium text-white tabular-nums whitespace-nowrap">{format(after)}</span>
      </div>
      <div className="flex-1 min-h-0" style={{ minHeight: 80 }}>
        <ResponsiveBar
          data={data}
          keys={["Before", "After"]}
          indexBy="id"
          groupMode="grouped"
          colors={[BLUE, GOLD]}
          animate={true}
          motionConfig="gentle"
          borderRadius={4}
          padding={0.3}
          innerPadding={4}
          enableLabel={false}
          enableGridY={false}
          axisBottom={{ tickSize: 0, tickPadding: 6 }}
          axisLeft={null}
          margin={{ top: 4, right: 8, bottom: 24, left: 8 }}
          theme={{
            background: "transparent",
            axis: { ticks: { text: { fill: "#6b7fa0", fontSize: 10 } } },
            grid: { line: { stroke: "rgba(255,255,255,0.04)" } },
            tooltip: { container: { background: "#0f1a2e", color: "#F0F4FF", fontSize: "12px", border: "1px solid rgba(255,215,0,0.15)", borderRadius: "8px" } },
          }}
        />
      </div>
    </div>
  );
}

// ── Slot machine weight row ─────────────────────────────────────────────────
function WeightRow({
  asset, beforeW, afterW, isNote, rowIndex,
}: {
  asset: string; beforeW: number | undefined; afterW: number; isNote: boolean; rowIndex: number;
}) {
  const delta = isNote ? 0 : +((afterW) - (beforeW ?? 0)).toFixed(1);
  const slotDelay = rowIndex * 50;
  const { display: animAfter, landed } = useSlotNumber(afterW, slotDelay + 200);

  return (
    <div
      className={`flex items-center py-1.5 border-b border-white/[0.05] last:border-0 ${
        isNote ? "rounded-lg bg-[#FFD700]/[0.08] border border-[#FFD700]/25 px-2 -mx-2 my-0.5" : ""
      }`}
      style={isNote ? { animation: 'goldPulse 2.5s ease-in-out infinite' } : undefined}
    >
      <span className={`flex-1 text-[11px] font-['DM_Sans'] truncate pr-1 ${
        isNote ? "text-[#FFD700] font-medium" : "text-[#6b7fa0]"
      }`}>{asset}</span>
      <span className={`w-14 text-right text-[11px] font-['DM_Mono'] tabular-nums ${
        isNote ? "text-[#6b7fa0]/40" : "text-[#c0ccdf]"
      }`}>{isNote ? "—" : `${(beforeW ?? 0).toFixed(1)}%`}</span>
      <span className="w-4 text-center text-[#6b7fa0]/30 text-[9px]">→</span>
      <span className={`w-14 text-right text-[11px] font-['DM_Mono'] tabular-nums font-medium ${
        isNote ? "text-[#FFD700]" : "text-white"
      }`}>{animAfter.toFixed(1)}%</span>
      <span className="w-12 text-right">
        {isNote ? (
          <span className="text-[8px] font-bold font-['DM_Sans'] text-[#FFD700] bg-[#FFD700]/15 border border-[#FFD700]/30 px-1.5 py-0.5 rounded-full">
            NEW
          </span>
        ) : delta !== 0 ? (
          <span className={`text-[9px] font-['DM_Mono'] rounded-full px-1.5 py-0.5 tabular-nums transition-opacity duration-300 ${
            landed ? "opacity-100" : "opacity-0"
          } ${delta < 0 ? "bg-[#ff4444]/15 text-[#ff4444]" : "bg-[#00e676]/15 text-[#00e676]"}`}>
            {delta > 0 ? "+" : ""}{delta}%
          </span>
        ) : null}
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────
export default function ImprovementDetail({ index, onClose }: Props) {
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    api.getImprovementDetail(index)
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load detail"))
      .finally(() => setLoading(false));
  }, [index]);

  // Restyle Plotly histogram — gold for note series
  const styledHistogram = useMemo(() => {
    if (!detail) return null;
    const raw = detail.histogram;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (raw.data as any[]).map((trace: any, i: number) => ({
      ...trace,
      marker: {
        ...trace.marker,
        color: i === 0 ? "rgba(59,130,246,0.25)" : "rgba(212,160,23,0.25)",
        line: { color: i === 0 ? "#3B82F6" : "#FFD700", width: 1.5 },
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawLayout = raw.layout as any;
    const layout = {
      ...rawLayout,
      paper_bgcolor: "transparent",
      plot_bgcolor: "transparent",
      font: { family: "DM Mono, monospace", color: "#6b7fa0", size: 11 },
      xaxis: { ...rawLayout?.xaxis, gridcolor: "rgba(255,255,255,0.05)", tickfont: { family: "DM Mono", size: 10, color: "#6b7fa0" } },
      yaxis: { ...rawLayout?.yaxis, gridcolor: "rgba(255,255,255,0.05)", tickfont: { family: "DM Mono", size: 10, color: "#6b7fa0" } },
      legend: { ...rawLayout?.legend, bgcolor: "rgba(15,26,46,0.85)", bordercolor: "rgba(255,255,255,0.1)", borderwidth: 1, font: { family: "DM Sans", size: 12, color: "#F0F4FF" } },
      margin: { l: 50, r: 20, t: 30, b: 50 },
      shapes: (rawLayout?.shapes || []).map((s: Record<string, unknown>) => ({
        ...s, line: { ...(s.line as Record<string, unknown> || {}), color: "#ff4444", dash: "dot" },
      })),
    };
    return { data, layout };
  }, [detail]);

  const backButton = (
    <button
      onClick={onClose}
      className="fixed top-6 left-6 z-[60] flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.08] border border-white/[0.12] text-[#6b7fa0] hover:text-[#F0F4FF] hover:bg-white/[0.12] hover:border-white/[0.25] transition-all duration-200 text-sm font-['DM_Sans']"
      style={{ animation: 'overlayIn 300ms ease-out 100ms both' }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M10 12L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      Back
    </button>
  );

  const globalStyles = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@500&family=DM+Sans:wght@400;500&family=Syne:wght@700&display=swap');
      @keyframes overlayIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes cardEntrance { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes goldPulse {
        0%, 100% { box-shadow: 0 0 0px #D4A017; }
        50%       { box-shadow: 0 0 16px #FFD700, 0 0 32px rgba(255,215,0,0.3); }
      }
    `}</style>
  );

  const overlayBg = {
    background: `radial-gradient(ellipse at 15% 50%, rgba(255,215,0,0.04) 0%, transparent 55%), radial-gradient(ellipse at 85% 15%, rgba(59,130,246,0.06) 0%, transparent 55%), ${OVERLAY_BG}`,
    animation: 'overlayIn 300ms ease-out both',
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden" style={overlayBg}>
        {globalStyles}{backButton}
        <div className="max-w-[1400px] mx-auto px-6 pt-20 pb-6 h-full">
          <div className="animate-pulse space-y-4 h-full">
            <div className="h-14 bg-white/[0.04] rounded-2xl" />
            <div className="flex gap-4 flex-1">
              <div className="w-[27%] bg-white/[0.04] rounded-2xl" />
              <div className="flex-1 bg-white/[0.04] rounded-2xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden" style={overlayBg}>
        {globalStyles}{backButton}
        <div className="max-w-[1400px] mx-auto px-6 pt-20 pb-6">
          <div className="bg-[#ff4444]/10 border border-[#ff4444]/25 text-[#ff4444] rounded-xl px-5 py-4 text-sm font-['DM_Sans']">
            {error || "No data available."}
          </div>
        </div>
      </div>
    );
  }

  const { base_weights, after_weights, base_metrics, after_metrics } = detail;
  const allAssets = Object.entries(after_weights).sort(([, a], [, b]) => b - a);
  const typeCls = NOTE_TYPE_COLORS[detail.note_type] || NOTE_TYPE_COLORS.Absolute;
  const fmt2 = (v: number) => v.toFixed(2);
  const fmt4 = (v: number) => v.toFixed(4);
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" style={overlayBg}>
      {globalStyles}{backButton}

      <div className="max-w-[1400px] mx-auto px-6 pt-16 pb-4 h-full flex flex-col">
        {/* Note Header — gold accent */}
        <div
          className="rounded-2xl border border-[#FFD700]/20 bg-[#1a2740] px-5 py-3 mb-4 shrink-0"
          style={{ animation: 'cardEntrance 400ms ease-out both', boxShadow: '0 0 20px rgba(255,215,0,0.06)' }}
        >
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-bold text-white font-['Syne']">
              {detail.note_type}: {detail.underlier}
            </h2>
            <span className="text-[#6b7fa0] text-[10px] font-['DM_Mono']">
              #{detail.note_id}
            </span>
            <span className="text-[#6b7fa0] text-xs font-['DM_Sans']">
              Alloc: <span className="font-['DM_Mono'] font-medium text-[#FFD700]">{detail.alloc_pct}%</span>
            </span>
            {detail.protection_type && (
              <span className="text-[#6b7fa0] text-xs font-['DM_Sans']">
                Protection: <span className="text-[#c0ccdf]">{detail.protection_type} {detail.protection_pct > 0 ? `${detail.protection_pct}%` : ""}</span>
              </span>
            )}
          </div>
        </div>

        {/* Main two-column layout */}
        <div className="flex gap-4 flex-1 min-h-0">

          {/* LEFT: Portfolio Weights (~27%) */}
          <div
            className="w-[27%] shrink-0 rounded-2xl border border-white/[0.08] bg-[#1a2740] flex flex-col overflow-hidden"
            style={{ animation: 'cardEntrance 400ms ease-out 80ms both' }}
          >
            <div className="px-3 py-2 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center text-[8px] tracking-[0.14em] uppercase font-['Syne'] font-bold">
                <span className="flex-1 text-[#6b7fa0]">Asset</span>
                <span className="w-14 text-right text-[#3B82F6]">Before</span>
                <span className="w-4"></span>
                <span className="w-14 text-right text-[#FFD700]">After</span>
                <span className="w-12 text-right text-[#6b7fa0]">Delta</span>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-0.5">
              {allAssets.map(([asset, afterW], i) => (
                <WeightRow key={asset} asset={asset} beforeW={base_weights[asset]} afterW={afterW} isNote={base_weights[asset] === undefined} rowIndex={i} />
              ))}
            </div>
          </div>

          {/* RIGHT: Histogram + Metrics (~73%) */}
          <div className="flex-1 flex flex-col gap-4 min-h-0">

            {/* Top: Return Distribution (hero) */}
            <div
              className="flex-[5] rounded-2xl border border-white/[0.08] bg-[#1a2740] p-4 flex flex-col min-h-0"
              style={{ animation: 'cardEntrance 400ms ease-out 160ms both' }}
            >
              <div className="text-[11px] font-bold tracking-[0.15em] text-[#6b7fa0] uppercase pl-3 border-l-2 border-[#3B82F6] mb-2 font-['Syne'] shrink-0">
                Return Distribution
              </div>
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

            {/* Bottom: Metrics Comparison — larger with Nivo bar charts */}
            <div
              className="flex-[4] flex flex-col min-h-0"
              style={{ animation: 'cardEntrance 400ms ease-out 240ms both' }}
            >
              <div className="text-[11px] font-bold tracking-[0.15em] text-[#6b7fa0] uppercase pl-3 border-l-2 border-[#FFD700] mb-3 font-['Syne'] shrink-0">
                Metrics Comparison
              </div>
              <div className="grid grid-cols-6 gap-3 flex-1 min-h-0">
                <MetricCard label="Exp. Return" before={base_metrics.mean} after={after_metrics.mean} format={fmtPct} index={0} />
                <MetricCard label="Sharpe Ratio" before={base_metrics.sharpe} after={after_metrics.sharpe} format={fmt4} index={1} />
                <MetricCard label="% Negative" before={base_metrics.pct_neg} after={after_metrics.pct_neg} format={fmt2} lowerIsBetter index={2} />
                <MetricCard label="Shorty" before={base_metrics.shorty} after={after_metrics.shorty} format={fmt4} lowerIsBetter index={3} />
                <MetricCard label="D. Kurt." before={base_metrics.downside_kurt ?? 0} after={after_metrics.downside_kurt ?? 0} format={fmt4} lowerIsBetter index={4} />
                <MetricCard label="Exp. Income" before={base_metrics.expected_income_pct} after={after_metrics.expected_income_pct} format={fmtPct} index={5} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
