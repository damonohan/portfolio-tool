"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useAppContext } from "@/lib/AppContext";
import { api, Improvement } from "@/lib/api";
import { HistBins, plotlyToHistBins, smooth } from "@/lib/chartUtils";
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip,
} from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip);

export default function HistogramsSummaryPage() {
  const { framework, ranked, baseMetrics, sessionLoaded, setImprovementsComputed } = useAppContext();
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [histData, setHistData] = useState<(HistBins | null)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!sessionLoaded || ranked.length === 0 || fetchedRef.current) return;
    fetchedRef.current = true;

    const run = async () => {
      setLoading(true);
      setError("");
      try {
        // Ensure improvements are computed server-side
        const result = await api.findImprovements({
          portfolio_name: framework.portfolio_name,
          outlook: framework.outlook,
          risk_tolerance: framework.risk_tolerance,
          goal: framework.goal,
          horizon: framework.horizon,
        });
        setImprovements(result.improvements);
        setImprovementsComputed(true);

        // Fetch histograms in parallel
        const histPromises = result.improvements.map((_, i) => api.getHistogram(i).catch(() => null));
        const hists = await Promise.all(histPromises);
        setHistData(hists.map((h) => h ? plotlyToHistBins(h) : null));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load improvements");
        fetchedRef.current = false; // allow retry
      }
      finally { setLoading(false); }
    };
    run();
  }, [sessionLoaded, ranked, framework, setImprovementsComputed]);

  if (!sessionLoaded) {
    return <div style={{ padding: 80, textAlign: "center", color: "var(--text-muted)" }}>Loading...</div>;
  }

  if (error) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
        <div className="halo-card" style={{ padding: 40 }}>
          <p style={{ color: "var(--accent-red)", fontSize: 15, marginBottom: 16 }}>{error}</p>
          <Link href="/analysis" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontWeight: 600 }}>
            ← Back to Analysis
          </Link>
        </div>
      </div>
    );
  }

  if (ranked.length === 0 && !loading) {
    return (
      <div style={{ maxWidth: 600, margin: "80px auto", textAlign: "center" }}>
        <div className="halo-card" style={{ padding: 40 }}>
          <p style={{ fontSize: 15, marginBottom: 16 }}>No candidates available.</p>
          <Link href="/analysis" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontWeight: 600 }}>
            ← Back to Analysis
          </Link>
        </div>
      </div>
    );
  }

  const top = ranked[0];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 12, padding: "12px 20px", marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/analysis" style={{
            background: "none", border: "1px solid var(--border)", color: "var(--text-secondary)",
            padding: "6px 14px", borderRadius: 6, textDecoration: "none", fontSize: 13,
          }}>← Back to Analysis</Link>
          <span style={{ fontSize: 18, fontWeight: 600 }}>Histogram Comparison</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href={api.exportCsvUrl()} className="dl-btn" download>↓ Export All CSV</a>
          <a href={api.exportPdfUrl()} className="dl-btn" download>↓ Export PDF</a>
        </div>
      </div>

      {/* Context bar */}
      <div style={{
        display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap",
        background: "var(--bg-card)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "14px 20px", marginBottom: 20,
      }}>
        {[
          ["Portfolio", framework.portfolio_name],
          ["Outlook", framework.outlook],
          ["Risk", framework.risk_tolerance],
          ["Goal", framework.goal],
          ["Horizon", `${framework.horizon}yr`],
          ["Alloc Range", "5% – 30%"],
        ].map(([label, value]) => (
          <div key={label} style={{ fontSize: 12 }}>
            <span style={{ color: "var(--text-muted)" }}>{label}:</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 600, marginLeft: 4 }}>{value}</span>
          </div>
        ))}
      </div>

      {/* Insight banner */}
      {top && baseMetrics && (
        <div className="insight-banner" style={{ marginBottom: 20 }}>
          <span style={{ fontSize: 18, flexShrink: 0, marginTop: 1 }}>📈</span>
          <div className="insight-text">
            <strong>{ranked.length} candidates</strong> passed acceptance criteria. The top candidate ({top.note_id}) improves Sharpe by{" "}
            <strong>+{(top.sharpe - baseMetrics.sharpe).toFixed(2)}</strong> and reduces negative outcomes by{" "}
            <strong>{Math.abs(top.pct_neg - baseMetrics.pct_neg).toFixed(1)} pp</strong>. Click any card for a deep-dive with full return distribution.
          </div>
        </div>
      )}

      {loading && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)" }}>
          Loading histogram data...
        </div>
      )}

      {/* 5-column card grid */}
      {!loading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16, marginBottom: 24 }}>
          {ranked.map((cand, idx) => {
            const hist = histData[idx];
            const isBest = idx === 0;
            const sharpeDelta = baseMetrics ? cand.sharpe - baseMetrics.sharpe : 0;
            const pctNegDelta = baseMetrics ? cand.pct_neg - baseMetrics.pct_neg : 0;
            const returnDelta = baseMetrics ? (cand.mean - baseMetrics.mean) * 100 : 0;

            return (
              <Link
                key={cand.note_id}
                href={`/histogram/${idx}`}
                style={{
                  background: "var(--bg-card)",
                  border: "1px solid var(--border)",
                  borderRadius: 14,
                  padding: 20,
                  cursor: "pointer",
                  transition: "all 0.25s",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  textDecoration: "none",
                  color: "inherit",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--halo-teal)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.transform = "";
                  e.currentTarget.style.boxShadow = "";
                }}
              >
                {isBest && (
                  <span style={{
                    position: "absolute", top: -8, right: 12,
                    background: "var(--accent-gold)", color: "#4a3800",
                    fontSize: 9, fontWeight: 800, padding: "2px 8px",
                    borderRadius: 6, letterSpacing: "0.5px",
                  }}>BEST</span>
                )}
                <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 8 }}>
                  #{idx + 1} &middot; Score: {cand.score.toFixed(2)}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                  {cand.note_type}: {cand.note_id}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 12 }}>
                  {Math.round(cand.alloc_pct * 100)}% alloc
                </div>

                {/* Mini histogram */}
                <div style={{ height: 80, marginBottom: 12, borderRadius: 8, overflow: "hidden", background: "var(--bg-chart)" }}>
                  {hist ? (
                    <MiniHistogram data={hist} />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#999" }}>
                      No data
                    </div>
                  )}
                </div>

                {/* 3 key metrics */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginTop: "auto" }}>
                  {[
                    { label: "Sharpe", value: cand.sharpe.toFixed(2), delta: sharpeDelta, lower: false },
                    { label: "% Neg", value: `${cand.pct_neg.toFixed(1)}%`, delta: pctNegDelta, lower: true },
                    { label: "Return", value: `${(cand.mean * 100).toFixed(1)}%`, delta: returnDelta, lower: false },
                  ].map((m) => {
                    const good = m.lower ? m.delta <= 0 : m.delta >= 0;
                    return (
                      <div key={m.label} style={{ textAlign: "center" }}>
                        <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase" }}>{m.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{m.value}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: good ? "var(--halo-cyan)" : "var(--accent-red)" }}>
                          {m.delta >= 0 ? "+" : ""}{m.delta.toFixed(2)}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <span style={{
                  display: "block", marginTop: 12, width: "100%", padding: 8,
                  border: "1px solid rgba(0,183,205,0.3)",
                  background: "rgba(0,183,205,0.06)",
                  borderRadius: 8, color: "var(--halo-cyan)",
                  fontSize: 12, fontWeight: 600, textAlign: "center",
                }}>
                  View Full Detail →
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Bottom actions */}
      <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: "20px 0" }}>
        <Link href="/analysis" style={{
          background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
          padding: "14px 36px", borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: "none",
        }}>← Back to Analysis</Link>
        <Link href="/frontier" style={{
          background: "transparent", border: "1px solid var(--border)", color: "var(--text-secondary)",
          padding: "14px 36px", borderRadius: 12, fontSize: 15, fontWeight: 600, textDecoration: "none",
        }}>View Frontier →</Link>
      </div>
    </div>
  );
}

function MiniHistogram({ data }: { data: HistBins }) {
  const smoothedBase = smooth(data.baseCounts);
  const smoothedCand = smooth(data.candCounts);
  // Downsample for mini view
  const step = Math.max(1, Math.floor(data.labels.length / 40));
  const labels = data.labels.filter((_, i) => i % step === 0);
  const baseC = data.baseCounts.filter((_, i) => i % step === 0);
  const candC = data.candCounts.filter((_, i) => i % step === 0);
  const sBase = smoothedBase.filter((_, i) => i % step === 0);
  const sCand = smoothedCand.filter((_, i) => i % step === 0);

  return (
    <Chart
      type="bar"
      data={{
        labels,
        datasets: [
          {
            type: "bar" as const,
            data: baseC,
            backgroundColor: "rgba(120,144,156,0.25)",
            borderWidth: 0,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          },
          {
            type: "bar" as const,
            data: candC,
            backgroundColor: "rgba(0,183,205,0.25)",
            borderWidth: 0,
            barPercentage: 1.0,
            categoryPercentage: 1.0,
          },
          {
            type: "line" as const,
            data: sBase,
            borderColor: "rgba(120,144,156,0.6)",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
          },
          {
            type: "line" as const,
            data: sCand,
            borderColor: "rgba(0,183,205,0.8)",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.4,
            fill: false,
          },
        ],
      }}
      options={{
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip: { enabled: false }, legend: { display: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
        animation: false,
      }}
      height={80}
    />
  );
}
