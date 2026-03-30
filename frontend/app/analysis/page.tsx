"use client";

import Link from "next/link";
import { useAppContext } from "@/lib/AppContext";
import { api } from "@/lib/api";

const OUTLOOKS = ["Bearish", "Neutral", "Bullish"];
const RISK_LEVELS = ["Conservative", "Moderate", "Aggressive"];
const GOALS = ["Growth", "Balanced", "Income"];
const HORIZONS = [1, 2, 3];

const NOTE_TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Growth:   { bg: "rgba(102,187,106,0.15)", color: "#66bb6a" },
  Income:   { bg: "rgba(79,195,247,0.15)",  color: "#4fc3f7" },
  Digital:  { bg: "rgba(171,71,188,0.15)",  color: "#ab47bc" },
  Absolute: { bg: "rgba(255,167,38,0.15)",  color: "#ffa726" },
  MLCD:     { bg: "rgba(20,184,166,0.15)",  color: "#14b8a6" },
  PPN:      { bg: "rgba(20,184,166,0.15)",  color: "#14b8a6" },
  Snowball: { bg: "rgba(244,63,94,0.15)",   color: "#f43f5e" },
};

export default function AnalysisPage() {
  const {
    framework, setFramework,
    portfolioNames, precalcData, precalcLoading, precalcStatus,
    baseMetrics, ranked,
    minAlloc, maxAlloc, setMinAlloc, setMaxAlloc,
    sessionLoaded,
  } = useAppContext();

  const { outlook, risk_tolerance: risk, goal, portfolio_name: portName, horizon } = framework;

  const updateFramework = (partial: Partial<typeof framework>) => {
    setFramework({ ...framework, ...partial });
  };

  if (!sessionLoaded) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: "80px 0", color: "var(--text-muted)" }}>
        Loading session...
      </div>
    );
  }

  const noData = !precalcLoading && portName && !precalcData[portName];

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "24px" }}>

      {/* ── Step 1: Select Base Portfolio ──────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>1</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Select Base Portfolio</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Choose the portfolio to analyze. Metrics shown for selected horizon.
          </div>
        </div>
      </div>

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, 1fr)",
        gap: 12,
        marginBottom: 32,
      }}>
        {portfolioNames.map((name) => {
          const m = precalcData[name]?._base?.[String(horizon)];
          const selected = portName === name;
          return (
            <button
              key={name}
              onClick={() => updateFramework({ portfolio_name: name })}
              style={{
                background: selected ? "rgba(0,183,205,0.06)" : "var(--bg-card)",
                border: `2px solid ${selected ? "var(--halo-cyan)" : "var(--border)"}`,
                borderRadius: 12,
                padding: 16,
                cursor: "pointer",
                transition: "all 0.2s",
                position: "relative",
                textAlign: "left",
                color: "var(--text-primary)",
                boxShadow: selected ? "0 0 0 1px rgba(0,183,205,0.15)" : "none",
              }}
            >
              {selected && (
                <span style={{ position: "absolute", top: 8, right: 10, color: "var(--halo-cyan)", fontSize: 16, fontWeight: 700 }}>✓</span>
              )}
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>{name}</div>
              {m ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {[
                    { label: "Exp. Return", value: `${(m.mean * 100).toFixed(2)}%` },
                    { label: "Std Dev", value: `${(m.std * 100).toFixed(2)}%` },
                    { label: "Sharpe", value: m.sharpe.toFixed(3) },
                    { label: "% Neg", value: `${m.pct_neg.toFixed(1)}%` },
                  ].map((metric) => (
                    <div key={metric.label}>
                      <div style={{ fontSize: 9, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.3px" }}>{metric.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--halo-cyan)" }}>{metric.value}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>No data</div>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Step 2: Framework & Horizon ──────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>2</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Framework &amp; Horizon</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Configure market outlook, risk tolerance, goal, and simulation horizon.
            {" "}<Link href="/admin/framework-config" style={{ color: "var(--halo-cyan)", textDecoration: "none", fontSize: 12, fontWeight: 600 }}>Configure Framework Rules</Link>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20, marginBottom: 32 }}>
        {[
          { label: "Market Outlook", options: OUTLOOKS, value: outlook, key: "outlook" },
          { label: "Risk Tolerance", options: RISK_LEVELS, value: risk, key: "risk_tolerance" },
          { label: "Portfolio Goal", options: GOALS, value: goal, key: "goal" },
        ].map((group) => (
          <div key={group.key}>
            <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {group.label}
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {group.options.map((o) => {
                const active = group.value === o;
                return (
                  <button
                    key={o}
                    onClick={() => updateFramework({ [group.key]: o })}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 20,
                      fontSize: 13,
                      fontWeight: active ? 600 : 500,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      border: `1px solid ${active ? "var(--halo-cyan)" : "var(--border)"}`,
                      background: active ? "linear-gradient(135deg, rgba(0,183,205,0.2), rgba(126,190,197,0.15))" : "transparent",
                      color: active ? "#fff" : "var(--text-secondary)",
                    }}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <label style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, display: "block", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Simulation Horizon
          </label>
          <div style={{ display: "flex", gap: 6 }}>
            {HORIZONS.map((h) => {
              const active = horizon === h;
              return (
                <button
                  key={h}
                  onClick={() => updateFramework({ horizon: h })}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 20,
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    border: `1px solid ${active ? "var(--halo-cyan)" : "var(--border)"}`,
                    background: active ? "linear-gradient(135deg, rgba(0,183,205,0.2), rgba(126,190,197,0.15))" : "transparent",
                    color: active ? "#fff" : "var(--text-secondary)",
                  }}
                >
                  {h} {h === 1 ? "Year" : "Years"}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Step 3: Note Allocation Range ──────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#fff",
        }}>3</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Note Allocation Range</div>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Click to set min and max. Candidates between are highlighted.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {[5, 10, 15, 20, 25, 30, 35, 40].map((s) => {
            const isMin = s === minAlloc;
            const isMax = s === maxAlloc;
            const inRange = s > minAlloc && s < maxAlloc;
            const isEndpoint = isMin || isMax;
            return (
              <button
                key={s}
                onClick={() => {
                  if (s <= minAlloc) setMinAlloc(s);
                  else if (s >= maxAlloc) setMaxAlloc(s);
                  else {
                    if (s - minAlloc <= maxAlloc - s) setMinAlloc(s);
                    else setMaxAlloc(s);
                  }
                }}
                style={{
                  padding: "7px 14px",
                  borderRadius: 16,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.15s",
                  border: `1px solid ${isEndpoint ? "var(--halo-cyan)" : inRange ? "rgba(0,183,205,0.4)" : "var(--border)"}`,
                  background: isEndpoint ? "var(--halo-cyan)" : inRange ? "rgba(0,183,205,0.12)" : "transparent",
                  color: isEndpoint ? "#fff" : inRange ? "var(--halo-cyan)" : "var(--text-muted)",
                  minWidth: 52,
                  textAlign: "center",
                }}
              >
                {s}%{isMin ? " min" : isMax ? " max" : ""}
              </button>
            );
          })}
        </div>
        <div style={{ fontSize: 13, color: "var(--halo-cyan)", fontWeight: 600 }}>
          {minAlloc}% – {maxAlloc}%
        </div>
      </div>

      {/* Divider */}
      <div style={{ borderTop: "1px solid var(--border)", margin: "8px 0 28px" }} />

      {/* Loading */}
      {precalcLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "40px 0", color: "var(--text-muted)" }}>
          {precalcStatus || "Loading pre-computed data..."}
        </div>
      )}

      {noData && (
        <div className="insight-banner" style={{ marginBottom: 24 }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <div className="insight-text">
            No pre-calc data for <strong>{portName}</strong>. Use Admin (gear icon) to upload data and build portfolios first.
          </div>
        </div>
      )}

      {/* ── Top 5 Candidates Table ──────────────────── */}
      {baseMetrics && !precalcLoading && (
        <div className="halo-card" style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Top 5 Improvement Candidates</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                fontSize: 11, color: "var(--text-muted)",
                background: "rgba(255,255,255,0.05)",
                padding: "4px 12px", borderRadius: 12,
              }}>
                {outlook} / {goal} / {risk} &middot; Updates instantly
              </div>
              <a href={api.exportCsvUrl()} className="dl-btn" download>↓ CSV</a>
              <a href={api.exportPdfUrl()} className="dl-btn" download>↓ PDF</a>
            </div>
          </div>

          {ranked.length === 0 ? (
            <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
              No notes pass the current framework filters. Try changing the outlook, goal, or risk tolerance.
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Rank", "Note ID", "Type", "Alloc", "Sharpe", "% Neg", "Exp. Return", "Std Dev", "Income", "Score", ""].map((h) => (
                    <th key={h} style={{
                      fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase",
                      letterSpacing: "0.5px", padding: "10px 12px", textAlign: h === "" ? "center" : "left",
                      borderBottom: "1px solid var(--border)", fontWeight: 600,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, idx) => {
                  const rank = idx + 1;
                  const sharpeDelta = r.sharpe - baseMetrics.sharpe;
                  const pctNegDelta = r.pct_neg - baseMetrics.pct_neg;
                  const returnDelta = (r.mean - baseMetrics.mean) * 100;
                  const stdDelta = (r.std - baseMetrics.std) * 100;
                  const newIncome = baseMetrics.expected_income_pct + r.income_boost * 100;
                  const incomeDelta = r.income_boost * 100;

                  const rankStyle: React.CSSProperties = {
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 28, height: 28, borderRadius: "50%",
                    fontSize: 12, fontWeight: 700,
                    ...(rank === 1 ? { background: "linear-gradient(135deg, #ffd54f, #ffb300)", color: "#4a3800" }
                      : rank === 2 ? { background: "rgba(192,192,192,0.3)", color: "#c0c0c0" }
                      : rank === 3 ? { background: "rgba(205,127,50,0.3)", color: "#cd7f32" }
                      : { background: "rgba(255,255,255,0.06)", color: "var(--text-muted)" }),
                  };

                  const typeColor = NOTE_TYPE_COLORS[r.note_type] ?? { bg: "rgba(255,255,255,0.06)", color: "var(--text-muted)" };

                  const DeltaSpan = ({ val, lower }: { val: number; lower?: boolean }) => {
                    const good = lower ? val <= 0 : val >= 0;
                    return (
                      <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 4, color: good ? "var(--halo-cyan)" : "var(--accent-red)" }}>
                        {val >= 0 ? "+" : ""}{val.toFixed(2)}
                      </span>
                    );
                  };

                  return (
                    <tr
                      key={r.note_id}
                      onClick={() => {
                        // Will navigate to histogram detail — handled by Link below
                      }}
                      style={{
                        borderBottom: "1px solid rgba(30,58,82,0.3)",
                        transition: "background 0.15s",
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,183,205,0.04)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                    >
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        <span style={rankStyle}>{rank}</span>
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13, fontWeight: 600 }}>{r.note_id}</td>
                      <td style={{ padding: "14px 12px" }}>
                        <span style={{
                          display: "inline-block", padding: "2px 10px", borderRadius: 10,
                          fontSize: 11, fontWeight: 600,
                          background: typeColor.bg, color: typeColor.color,
                        }}>
                          {r.note_type}
                        </span>
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>{Math.round(r.alloc_pct * 100)}%</td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        {r.sharpe.toFixed(4)}<DeltaSpan val={sharpeDelta} />
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        {r.pct_neg.toFixed(2)}%<DeltaSpan val={pctNegDelta} lower />
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        {(r.mean * 100).toFixed(2)}%<DeltaSpan val={returnDelta} />
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        {(r.std * 100).toFixed(2)}%<DeltaSpan val={stdDelta} lower />
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13 }}>
                        {newIncome.toFixed(2)}%<DeltaSpan val={incomeDelta} />
                      </td>
                      <td style={{ padding: "14px 12px", fontSize: 13, fontWeight: 700 }}>{r.score.toFixed(2)}</td>
                      <td style={{ padding: "14px 12px", textAlign: "center" }}>
                        <Link
                          href={`/histogram/${idx}?note_id=${encodeURIComponent(r.note_id)}`}
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            display: "inline-block",
                            background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
                            border: "none", color: "#fff", padding: "6px 16px", borderRadius: 8,
                            fontSize: 12, fontWeight: 600, textDecoration: "none",
                            transition: "all 0.2s",
                          }}
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Bottom Actions ──────────────────── */}
      {baseMetrics && !precalcLoading && (
        <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: "20px 0" }}>
          <Link
            href="/frontier"
            style={{
              background: "transparent", border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              padding: "14px 36px", borderRadius: 12,
              fontSize: 15, fontWeight: 600,
              textDecoration: "none", transition: "all 0.2s",
            }}
          >
            View Frontier →
          </Link>
          <Link
            href="/histograms"
            style={{
              background: "linear-gradient(135deg, var(--halo-cyan), var(--halo-teal))",
              border: "none", color: "#fff",
              padding: "14px 36px", borderRadius: 12,
              fontSize: 15, fontWeight: 600,
              textDecoration: "none", transition: "all 0.2s",
              letterSpacing: "0.3px",
            }}
          >
            View Histograms →
          </Link>
        </div>
      )}
    </div>
  );
}
