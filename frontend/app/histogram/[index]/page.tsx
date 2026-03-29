"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";
import { api, ImprovementDetail as DetailData, Improvement } from "@/lib/api";
import { plotlyToHistBins, smooth } from "@/lib/chartUtils";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend,
} from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, Legend);

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

const NOTE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Growth:   { bg: "rgba(102,187,106,0.2)", color: "#66bb6a" },
  Income:   { bg: "rgba(79,195,247,0.2)",  color: "#4fc3f7" },
  Digital:  { bg: "rgba(171,71,188,0.2)",  color: "#ab47bc" },
  Absolute: { bg: "rgba(255,167,38,0.2)",  color: "#ffa726" },
  MLCD:     { bg: "rgba(20,184,166,0.2)",  color: "#14b8a6" },
  PPN:      { bg: "rgba(20,184,166,0.2)",  color: "#14b8a6" },
  Snowball: { bg: "rgba(244,63,94,0.2)",   color: "#f43f5e" },
};

export default function HistogramDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { framework, setImprovementsComputed, sessionLoaded } = useAppContext();
  const index = Number(params.index);
  const noteIdParam = searchParams.get("note_id");

  const [detail, setDetail] = useState<DetailData | null>(null);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAssets, setShowAssets] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!sessionLoaded || !framework.portfolio_name) return;
    // Reset on index/note change
    fetchedRef.current = false;
  }, [sessionLoaded, framework.portfolio_name, index, noteIdParam]);

  useEffect(() => {
    if (!sessionLoaded || !framework.portfolio_name || fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError("");

    const fetchDetail = async () => {
      // Always call findImprovements to ensure backend has the data
      try {
        const result = await api.findImprovements({
          portfolio_name: framework.portfolio_name,
          outlook: framework.outlook,
          risk_tolerance: framework.risk_tolerance,
          goal: framework.goal,
          horizon: framework.horizon,
          ensure_note_id: noteIdParam || undefined,
        });
        setImprovementsComputed(true);
        setImprovements(result.improvements);

        // Find the correct backend index for this note
        let detailIndex = index;
        if (noteIdParam && result.improvements.length > 0) {
          const matchIdx = result.improvements.findIndex(imp => imp.note_id === noteIdParam);
          if (matchIdx >= 0) detailIndex = matchIdx;
        }

        if (detailIndex >= result.improvements.length) {
          setError("Improvement index out of range.");
          setLoading(false);
          return;
        }

        const d = await api.getImprovementDetail(detailIndex);
        setDetail(d);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load detail");
      }
      setLoading(false);
    };
    fetchDetail();
  }, [sessionLoaded, framework, index, noteIdParam, setImprovementsComputed]);

  // Parse histogram data for Chart.js
  const chartData = useMemo(() => {
    if (!detail?.histogram) return null;
    const bins = plotlyToHistBins(detail.histogram, 80);
    if (!bins) return null;

    const smoothedBase = smooth(bins.baseCounts);
    const smoothedCand = smooth(bins.candCounts);

    return { labels: bins.labels, baseCounts: bins.baseCounts, candCounts: bins.candCounts, smoothedBase, smoothedCand };
  }, [detail]);

  if (loading) return (
    <div style={{ padding: "80px 0", textAlign: "center", color: "var(--text-muted)" }}>Loading detail...</div>
  );

  if (error || !detail) return (
    <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
      <div className="halo-card" style={{ padding: 40 }}>
        <p style={{ fontSize: 15, color: "var(--accent-red)", marginBottom: 16 }}>{error || "No data available."}</p>
        <Link href="/histograms" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontWeight: 600 }}>← Back to Histograms</Link>
      </div>
    </div>
  );

  const { base_metrics, after_metrics, base_weights, after_weights } = detail;
  const typeColor = NOTE_TYPE_COLORS[detail.note_type] ?? NOTE_TYPE_COLORS.Absolute;
  const total = improvements.length || 1;
  // Find this detail's score from improvements list
  const matchingImp = improvements.find(imp => imp.note_id === detail.note_id);
  const detailScore = matchingImp?.score ?? 0;

  // Bucket calculation for composition
  const allAssets = Object.entries(after_weights).sort(([, a], [, b]) => b - a);
  const isNote = (asset: string) => base_weights[asset] === undefined;

  const metrics = [
    { label: "Exp. Return", before: base_metrics.mean, after: after_metrics.mean, format: (v: number) => `${v.toFixed(2)}%`, lower: false },
    { label: "Std Dev", before: base_metrics.std, after: after_metrics.std, format: (v: number) => `${v.toFixed(2)}%`, lower: true },
    { label: "Sharpe Ratio", before: base_metrics.sharpe, after: after_metrics.sharpe, format: (v: number) => v.toFixed(4), lower: false },
    { label: "% Negative", before: base_metrics.pct_neg, after: after_metrics.pct_neg, format: (v: number) => v.toFixed(2), lower: true },
    { label: "Shorty", before: base_metrics.shorty, after: after_metrics.shorty, format: (v: number) => v.toFixed(4), lower: true },
    { label: "D. Kurt.", before: base_metrics.downside_kurt ?? 0, after: after_metrics.downside_kurt ?? 0, format: (v: number) => v.toFixed(4), lower: true },
    { label: "Exp. Income", before: base_metrics.expected_income_pct, after: after_metrics.expected_income_pct, format: (v: number) => `${v.toFixed(2)}%`, lower: false },
    { label: "Score", before: 0, after: detailScore, format: (v: number) => v.toFixed(2), lower: false },
  ];

  const sharpeDelta = after_metrics.sharpe - base_metrics.sharpe;
  const pctNegDelta = after_metrics.pct_neg - base_metrics.pct_neg;

  return (
    <div>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 24px",
        background: "var(--bg-card)", borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/histograms" style={{
            background: "none", border: "1px solid var(--border)", color: "var(--text-secondary)",
            padding: "6px 14px", borderRadius: 6, textDecoration: "none", fontSize: 13,
          }}>← Back</Link>
          <span style={{ fontSize: 18, fontWeight: 600 }}>{detail.note_type}: {detail.underlier}</span>
          <span style={{
            display: "inline-block", padding: "2px 10px", borderRadius: 12,
            fontSize: 11, fontWeight: 600, textTransform: "uppercase",
            background: typeColor.bg, color: typeColor.color,
          }}>{detail.note_type}</span>
          <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            #{detail.note_id} &middot; Allocation: <strong style={{ color: "var(--text-primary)" }}>{detail.alloc_pct}%</strong>
            {detail.protection_type && (
              <> &middot; Protection: <strong style={{ color: "var(--text-primary)" }}>{detail.protection_type} {detail.protection_pct > 0 ? `${detail.protection_pct}%` : ""}</strong></>
            )}
          </span>
        </div>
        <div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                if (index > 0) {
                  const prevNote = improvements[index - 1]?.note_id;
                  router.push(`/histogram/${index - 1}${prevNote ? `?note_id=${encodeURIComponent(prevNote)}` : ""}`);
                }
              }}
              disabled={index === 0}
              style={{
                background: "var(--bg-card)", border: "1px solid var(--border)",
                color: index === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                width: 36, height: 36, borderRadius: 6, cursor: index === 0 ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}
            >←</button>
            <button
              onClick={() => {
                if (index < total - 1) {
                  const nextNote = improvements[index + 1]?.note_id;
                  router.push(`/histogram/${index + 1}${nextNote ? `?note_id=${encodeURIComponent(nextNote)}` : ""}`);
                }
              }}
              disabled={index >= total - 1}
              style={{
                background: "var(--bg-card)", border: "1px solid var(--border)",
                color: index >= total - 1 ? "var(--text-muted)" : "var(--text-secondary)",
                width: 36, height: 36, borderRadius: 6, cursor: index >= total - 1 ? "default" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
              }}
            >→</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", marginTop: 4 }}>
            {index + 1} of {total}
          </div>
        </div>
      </div>

      {/* Main content: 2-column layout */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 340px",
        gap: 20, padding: "20px 24px", maxWidth: 1500, margin: "0 auto",
      }}>
        {/* Left column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Insight banner */}
          <div className="insight-banner">
            <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>⚡</span>
            <div className="insight-text">
              Adding this note <strong>improves Sharpe by {sharpeDelta >= 0 ? "+" : ""}{sharpeDelta.toFixed(2)}</strong> and{" "}
              <strong>{pctNegDelta <= 0 ? "reduces" : "increases"} negative outcomes by {Math.abs(pctNegDelta).toFixed(1)} pp</strong>,
              while shifting the return distribution rightward.
            </div>
          </div>

          {/* Chart */}
          {chartData && (
            <div style={{
              background: "var(--bg-chart)", borderRadius: 12, padding: 24, border: "1px solid #e0e4ea",
            }}>
              <h3 style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--halo-navy)", marginBottom: 4, fontWeight: 700 }}>
                Return Distribution
              </h3>
              <div style={{ fontSize: 13, color: "#6b7b8d", marginBottom: 16 }}>
                Base portfolio vs. with {detail.underlier} @ {detail.alloc_pct}% — {framework.horizon}yr, 10,000 sims
              </div>
              <div style={{ position: "relative", height: 360 }}>
                <Chart
                  type="bar"
                  data={{
                    labels: chartData.labels,
                    datasets: [
                      {
                        type: "bar" as const,
                        label: "Base Portfolio",
                        data: chartData.baseCounts,
                        backgroundColor: "rgba(100,130,160,0.3)",
                        borderColor: "rgba(100,130,160,0.5)",
                        borderWidth: 1,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0,
                      },
                      {
                        type: "bar" as const,
                        label: `With ${detail.underlier}`,
                        data: chartData.candCounts,
                        backgroundColor: "rgba(0,183,205,0.25)",
                        borderColor: "rgba(0,183,205,0.5)",
                        borderWidth: 1,
                        barPercentage: 1.0,
                        categoryPercentage: 1.0,
                      },
                      {
                        type: "line" as const,
                        label: "Base (smoothed)",
                        data: chartData.smoothedBase,
                        borderColor: "rgba(100,130,160,0.8)",
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                      },
                      {
                        type: "line" as const,
                        label: "Candidate (smoothed)",
                        data: chartData.smoothedCand,
                        borderColor: "rgba(0,183,205,0.9)",
                        borderWidth: 2,
                        pointRadius: 0,
                        tension: 0.4,
                        fill: false,
                      },
                    ],
                  }}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: { position: "top", labels: { color: "#6b7b8d", usePointStyle: true, padding: 16 } },
                      tooltip: { mode: "index", intersect: false },
                    },
                    scales: {
                      x: { ticks: { color: "#6b7b8d", maxTicksLimit: 15 }, grid: { color: "rgba(0,0,0,0.06)" } },
                      y: { ticks: { color: "#6b7b8d" }, grid: { color: "rgba(0,0,0,0.06)" } },
                    },
                  }}
                />
              </div>
            </div>
          )}

          {/* Metrics grid */}
          <div>
            <div className="section-label">Metrics Comparison — Base vs With Note</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
              {metrics.map((m, i) => (
                <MetricBarCard key={m.label} {...m} index={i} />
              ))}
            </div>
          </div>

          {/* Export */}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", padding: "12px 0" }}>
            <a href={api.exportCsvUrl()} className="dl-btn" download>↓ Export CSV</a>
            <a href={api.exportPdfUrl()} className="dl-btn" download>↓ Export PDF</a>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Note highlight */}
          <div style={{
            background: "rgba(255,213,79,0.08)",
            border: "1px solid rgba(255,213,79,0.25)",
            borderRadius: 8, padding: 12, marginBottom: 0,
          }}>
            <div style={{ fontSize: 10, color: "var(--accent-gold)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: 6 }}>
              Structured Note Added
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {detail.note_type}: {detail.underlier}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
              Allocation: {detail.alloc_pct}% &middot; Type: {detail.note_type}<br />
              Protection: {detail.protection_type} {detail.protection_pct > 0 ? `${detail.protection_pct}%` : ""} &middot; ID: #{detail.note_id}
            </div>
          </div>

          {/* Portfolio composition */}
          <div className="halo-card">
            <div className="section-label">Portfolio Composition</div>

            {/* Asset rows */}
            {allAssets.slice(0, showAssets ? undefined : 5).map(([asset, afterW], i) => {
              const beforeW = base_weights[asset];
              const note = isNote(asset);
              const delta = note ? 0 : +((afterW) - (beforeW ?? 0)).toFixed(1);
              return (
                <div key={asset} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: "1px solid rgba(30,58,82,0.5)",
                  ...(note ? { background: "rgba(255,213,79,0.08)", borderRadius: 6, padding: "8px 10px", margin: "4px -10px" } : {}),
                }}>
                  <span style={{ fontSize: 13, color: note ? "var(--accent-gold)" : "var(--text-secondary)", flex: 1 }}>{asset}</span>
                  <span style={{ fontSize: 13, color: "var(--text-secondary)", width: 50, textAlign: "right" }}>
                    {note ? "—" : `${(beforeW ?? 0).toFixed(1)}%`}
                  </span>
                  <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, width: 50, textAlign: "right" }}>
                    {afterW.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 11, width: 50, textAlign: "right" }}>
                    {note ? (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--accent-gold)", background: "rgba(255,213,79,0.15)", padding: "1px 6px", borderRadius: 8 }}>NEW</span>
                    ) : delta !== 0 ? (
                      <span style={{
                        display: "inline-block", padding: "1px 6px", borderRadius: 8, fontSize: 10, textAlign: "center",
                        ...(delta < 0
                          ? { background: "rgba(239,83,80,0.12)", color: "#c62828" }
                          : { background: "rgba(0,183,205,0.12)", color: "#00838f" }),
                      }}>
                        {delta > 0 ? "+" : ""}{delta}%
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}

            {allAssets.length > 5 && (
              <button
                onClick={() => setShowAssets(!showAssets)}
                style={{
                  background: "none", border: "none", color: "var(--accent-blue)",
                  cursor: "pointer", fontSize: 12, padding: "8px 0", width: "100%", textAlign: "center",
                }}
              >
                {showAssets ? "Show less ▲" : `Show all ${allAssets.length} assets ▼`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Metric comparison card with bar visualization
function MetricBarCard({ label, before, after, format, lower, index: cardIndex }: {
  label: string; before: number; after: number;
  format: (v: number) => string; lower: boolean; index: number;
}) {
  const diff = after - before;
  const improved = lower ? diff < 0 : diff > 0;
  const neutral = Math.abs(diff) < 1e-6;

  const maxVal = Math.max(Math.abs(before), Math.abs(after), 0.01);
  const beforeH = Math.round((Math.abs(before) / maxVal) * 70);
  const afterH = Math.round((Math.abs(after) / maxVal) * 70);

  return (
    <div style={{
      background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12,
      padding: "16px 16px 14px", display: "flex", flexDirection: "column",
      minHeight: 195,
    }}>
      <div style={{ fontSize: 14, color: "var(--halo-navy)", fontWeight: 700, marginBottom: 4, lineHeight: 1.2 }}>
        {label}
      </div>
      <span style={{
        display: "inline-flex", alignSelf: "flex-start",
        padding: "3px 10px", borderRadius: 10, fontSize: 11, fontWeight: 700,
        ...(neutral ? { background: "rgba(0,0,0,0.06)", color: "#888" }
          : improved ? { background: "rgba(0,183,205,0.12)", color: "#00838f" }
          : { background: "rgba(239,83,80,0.12)", color: "#c62828" }),
      }}>
        {diff >= 0 ? "+" : ""}{format(diff)}
      </span>

      <div style={{ flex: 1, display: "flex", alignItems: "flex-end", gap: 16, padding: "0 4px", minHeight: 0, marginTop: 8 }}>
        {/* Before bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#5a6d7e" }}>{format(before)}</div>
          <div style={{ width: "100%", background: "#f0f2f5", borderRadius: 6, height: 80, position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: beforeH, borderRadius: 6,
              background: "var(--halo-teal)", opacity: 0.5,
              transition: "height 0.5s ease",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "#8899aa", marginTop: 5, textTransform: "uppercase", letterSpacing: "0.3px" }}>Without Note</div>
        </div>
        {/* After bar */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: "#1a2a3a" }}>{format(after)}</div>
          <div style={{ width: "100%", background: "#f0f2f5", borderRadius: 6, height: 80, position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              height: afterH, borderRadius: 6,
              background: improved || neutral ? "var(--halo-cyan)" : "var(--accent-red)",
              opacity: improved || neutral ? 1 : 0.8,
              transition: "height 0.5s ease",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "#8899aa", marginTop: 5, textTransform: "uppercase", letterSpacing: "0.3px" }}>With Note</div>
        </div>
      </div>
    </div>
  );
}
