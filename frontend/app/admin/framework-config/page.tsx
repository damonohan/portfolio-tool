"use client";

import { useState, useEffect } from "react";
import { useAppContext } from "@/lib/AppContext";
import { api, FrameworkConfig, CellConfig } from "@/lib/api";

const OUTLOOKS  = ["Bullish", "Neutral", "Bearish"] as const;
const RISKS     = ["Conservative", "Moderate", "Aggressive"] as const;
const GOALS     = ["Growth", "Balanced", "Income"] as const;
const BUCKETS   = ["Equity", "Fixed Income", "Alternative", "Cash"] as const;
const ALL_TYPES = ["Growth", "Digital", "Absolute", "Income", "MLCD", "PPN", "Snowball"] as const;

type TabKey = "buckets" | "Bullish" | "Neutral" | "Bearish";

export default function FrameworkConfigPage() {
  const { setFrameworkConfig, loadPrecalc } = useAppContext();
  const [config, setConfig] = useState<FrameworkConfig | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("buckets");
  const [expandedCell, setExpanded] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getFrameworkConfig().then(setConfig).catch(() => {});
  }, []);

  if (!config) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 40, color: "#64748b" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            display: "inline-block", width: 20, height: 20,
            border: "2px solid #2563eb", borderTopColor: "transparent",
            borderRadius: "50%", animation: "spin 1s linear infinite",
          }} />
          Loading framework config...
        </div>
      </div>
    );
  }

  const updateBucket = (outlook: string, bucket: string, checked: boolean) => {
    setConfig((prev) => {
      if (!prev) return prev;
      const curr = prev.outlook_buckets[outlook] ?? [];
      const next = checked ? [...curr, bucket] : curr.filter((b) => b !== bucket);
      return { ...prev, outlook_buckets: { ...prev.outlook_buckets, [outlook]: next } };
    });
    setSaved(false);
  };

  const updateCell = (key: string, patch: Partial<CellConfig>) => {
    setConfig((prev) => {
      if (!prev) return prev;
      return { ...prev, cells: { ...prev.cells, [key]: { ...prev.cells[key], ...patch } } };
    });
    setSaved(false);
  };

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setError("");
    try {
      await api.saveFrameworkConfig(config);
      setSaved(true);
      setFrameworkConfig(config);
      // Refresh precalc in background since framework change invalidates it
      loadPrecalc();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("Reset all 27 cells to built-in defaults? Your customisations will be lost.")) return;
    setResetting(true);
    setError("");
    try {
      const result = await api.resetFrameworkConfig();
      setConfig(result.config);
      setSaved(true);
      setFrameworkConfig(result.config);
      loadPrecalc();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const tabStyle = (tab: TabKey): React.CSSProperties => ({
    padding: "10px 20px",
    fontSize: 13,
    fontWeight: activeTab === tab ? 600 : 500,
    cursor: "pointer",
    color: activeTab === tab ? "#1d4ed8" : "#64748b",
    background: activeTab === tab ? "#fff" : "transparent",
    borderTop: "none",
    borderLeft: "none",
    borderRight: "none",
    borderBottom: activeTab === tab ? "2px solid #2563eb" : "2px solid transparent",
    borderRadius: "8px 8px 0 0",
    transition: "all 0.2s",
  });

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "#1e293b", marginBottom: 4 }}>
          Framework Configuration
        </h2>
        <p style={{ fontSize: 13, color: "#64748b" }}>
          Configure note eligibility per Outlook / Risk / Goal cell. Saving triggers a background pre-calc refresh.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #e2e8f0", marginBottom: 20 }}>
        {(["buckets", "Bullish", "Neutral", "Bearish"] as const).map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={tabStyle(tab)}>
            {tab === "buckets" ? "Outlook Buckets" : tab}
          </button>
        ))}
      </div>

      {/* Outlook Buckets tab */}
      {activeTab === "buckets" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <p style={{ fontSize: 13, color: "#64748b" }}>
            Which asset buckets are reduced when computing portfolio metrics for each market outlook.
          </p>
          {OUTLOOKS.map((outlook) => (
            <div key={outlook} style={{
              background: "#f8fafc", borderRadius: 12,
              border: "1px solid #e2e8f0", padding: 16,
            }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#334155", marginBottom: 12 }}>{outlook}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
                {BUCKETS.map((bucket) => {
                  const checked = (config.outlook_buckets[outlook] ?? []).includes(bucket);
                  return (
                    <label key={bucket} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => updateBucket(outlook, bucket, e.target.checked)}
                        style={{ width: 16, height: 16 }}
                      />
                      <span style={{ fontSize: 13, color: "#334155" }}>{bucket}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-outlook 3x3 grid tabs */}
      {(["Bullish", "Neutral", "Bearish"] as const).map((outlook) =>
        activeTab !== outlook ? null : (
          <div key={outlook} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Column headers */}
            <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", gap: 12 }}>
              <div />
              {GOALS.map((g) => (
                <div key={g} style={{
                  textAlign: "center", fontSize: 11, fontWeight: 600,
                  color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px", padding: 4,
                }}>
                  Goal: {g}
                </div>
              ))}
            </div>

            {/* Grid rows */}
            {RISKS.map((risk) => (
              <div key={risk} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr 1fr", gap: 12, alignItems: "start" }}>
                <div style={{
                  textAlign: "right", fontSize: 11, fontWeight: 600,
                  color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px",
                  paddingTop: 12, paddingRight: 8,
                }}>
                  {risk}
                </div>

                {GOALS.map((goal) => {
                  const key = `${outlook}|${risk}|${goal}`;
                  const cell = config.cells[key];
                  const isExpanded = expandedCell === key;

                  if (!cell) {
                    return (
                      <div key={key} style={{
                        borderRadius: 12, border: "1px solid #e2e8f0",
                        background: "#f1f5f9", height: 64,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, color: "#94a3b8",
                      }}>
                        no config
                      </div>
                    );
                  }

                  return (
                    <div key={key} style={{
                      borderRadius: 12,
                      border: `1px solid ${isExpanded ? "#60a5fa" : "#e2e8f0"}`,
                      boxShadow: isExpanded ? "0 1px 4px rgba(96,165,250,0.15)" : "none",
                      transition: "all 0.2s",
                    }}>
                      {/* Summary — click to expand */}
                      <button
                        onClick={() => setExpanded(isExpanded ? null : key)}
                        style={{
                          width: "100%", textAlign: "left", padding: "10px 12px",
                          background: "none", border: "none", cursor: "pointer",
                          color: "#334155",
                        }}
                      >
                        <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
                          {cell.allowed_types.length > 0
                            ? cell.allowed_types.join(", ")
                            : <span style={{ color: "#94a3b8", fontWeight: 400 }}>All types</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
                          Max {cell.max_alloc_pct}% &middot; Prot {cell.min_protection_pct}&ndash;{cell.max_protection_pct}%
                        </div>
                        <div style={{ fontSize: 11, color: "#3b82f6", marginTop: 2 }}>
                          {isExpanded ? "collapse" : "edit"}
                        </div>
                      </button>

                      {/* Inline editor */}
                      {isExpanded && (
                        <div style={{
                          borderTop: "1px solid #bfdbfe", background: "#eff6ff",
                          padding: 12, borderRadius: "0 0 12px 12px",
                          display: "flex", flexDirection: "column", gap: 12,
                        }}>
                          {/* Allowed note types */}
                          <div>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 6 }}>Allowed Note Types</p>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              {ALL_TYPES.map((t) => (
                                <label key={t} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={cell.allowed_types.includes(t)}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...cell.allowed_types, t]
                                        : cell.allowed_types.filter((x) => x !== t);
                                      updateCell(key, { allowed_types: next });
                                    }}
                                    style={{ width: 14, height: 14 }}
                                  />
                                  <span style={{ fontSize: 12, color: "#334155" }}>{t}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {/* Protection range */}
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div>
                              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Min Protection %</label>
                              <input
                                type="number" min={0} max={100} step={1}
                                value={cell.min_protection_pct}
                                onChange={(e) => updateCell(key, { min_protection_pct: Number(e.target.value) })}
                                style={{
                                  width: "100%", border: "1px solid #cbd5e1", borderRadius: 6,
                                  padding: "4px 8px", fontSize: 12,
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Max Protection %</label>
                              <input
                                type="number" min={0} max={100} step={1}
                                value={cell.max_protection_pct}
                                onChange={(e) => updateCell(key, { max_protection_pct: Number(e.target.value) })}
                                style={{
                                  width: "100%", border: "1px solid #cbd5e1", borderRadius: 6,
                                  padding: "4px 8px", fontSize: 12,
                                }}
                              />
                            </div>
                          </div>

                          {/* Max allocation */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>Max Allocation %</label>
                            <input
                              type="number" min={0} max={100} step={0.5}
                              value={cell.max_alloc_pct}
                              onChange={(e) => updateCell(key, { max_alloc_pct: Number(e.target.value) })}
                              style={{
                                width: "100%", border: "1px solid #cbd5e1", borderRadius: 6,
                                padding: "4px 8px", fontSize: 12,
                              }}
                            />
                          </div>

                          {/* Allowed underlyings */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                              Allowed Underlyings <span style={{ fontWeight: 400, color: "#94a3b8" }}>(comma-sep, empty = any)</span>
                            </label>
                            <input
                              type="text"
                              value={cell.allowed_underlyings.join(", ")}
                              onChange={(e) => {
                                const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                                updateCell(key, { allowed_underlyings: vals });
                              }}
                              placeholder="e.g. SPX, RUT"
                              style={{
                                width: "100%", border: "1px solid #cbd5e1", borderRadius: 6,
                                padding: "4px 8px", fontSize: 12,
                              }}
                            />
                          </div>

                          {/* Allowed protection types */}
                          <div>
                            <label style={{ fontSize: 12, fontWeight: 600, color: "#475569", display: "block", marginBottom: 4 }}>
                              Allowed Protection Types <span style={{ fontWeight: 400, color: "#94a3b8" }}>(comma-sep, empty = any)</span>
                            </label>
                            <input
                              type="text"
                              value={cell.allowed_protection_types.join(", ")}
                              onChange={(e) => {
                                const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                                updateCell(key, { allowed_protection_types: vals });
                              }}
                              placeholder="e.g. Soft, Hard"
                              style={{
                                width: "100%", border: "1px solid #cbd5e1", borderRadius: 6,
                                padding: "4px 8px", fontSize: 12,
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )
      )}

      {/* Footer actions */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginTop: 24, paddingTop: 16, borderTop: "1px solid #e2e8f0",
      }}>
        <div>
          {error && <p style={{ fontSize: 13, color: "#dc2626" }}>{error}</p>}
          {saved && !error && (
            <p style={{ fontSize: 13, color: "#16a34a" }}>Saved — pre-calc is being refreshed in the background</p>
          )}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={handleReset}
            disabled={resetting || saving}
            style={{
              border: "1px solid #fbbf24", color: "#a16207", fontWeight: 600,
              padding: "8px 16px", borderRadius: 8, fontSize: 13,
              background: "transparent", cursor: resetting || saving ? "default" : "pointer",
              opacity: resetting || saving ? 0.5 : 1,
            }}
          >
            {resetting ? "Resetting..." : "Reset to Defaults"}
          </button>
          <button
            onClick={handleSave}
            disabled={saving || resetting}
            style={{
              background: "#1d4ed8", color: "#fff", fontWeight: 600,
              padding: "8px 24px", borderRadius: 8, fontSize: 13,
              border: "none", cursor: saving || resetting ? "default" : "pointer",
              opacity: saving || resetting ? 0.5 : 1,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {saving ? "Saving..." : "Save & Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
