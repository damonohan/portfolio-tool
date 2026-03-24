"use client";

import { useState, useEffect } from "react";
import { api, FrameworkConfig, CellConfig } from "@/lib/api";

const OUTLOOKS  = ["Bullish", "Neutral", "Bearish"] as const;
const RISKS     = ["Conservative", "Moderate", "Aggressive"] as const;
const GOALS     = ["Growth", "Balanced", "Income"] as const;
const BUCKETS   = ["Equity", "Fixed Income", "Alternative", "Cash"] as const;
const ALL_TYPES = ["Growth", "Digital", "Absolute", "Income", "MLCD", "PPN", "Snowball"] as const;

type TabKey = "buckets" | "Bullish" | "Neutral" | "Bearish";

interface Props {
  initialConfig: FrameworkConfig | null;
  onClose:  () => void;
  onSaved:  (config: FrameworkConfig) => void;
}

export default function ScreenFrameworkConfig({ initialConfig, onClose, onSaved }: Props) {
  const [config, setConfig]           = useState<FrameworkConfig | null>(initialConfig);
  const [activeTab, setActiveTab]     = useState<TabKey>("buckets");
  const [expandedCell, setExpanded]   = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error,    setError]    = useState("");
  const [saved,    setSaved]    = useState(false);

  // If no config was passed in, fetch from backend
  useEffect(() => {
    if (!config) {
      api.getFrameworkConfig().then(setConfig).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
        <div className="bg-white rounded-xl p-8 text-slate-500 flex items-center gap-3">
          <span className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full" />
          Loading…
        </div>
      </div>
    );
  }

  // ── Mutation helpers ────────────────────────────────────────────────────────
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
      onSaved(config);
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
      onSaved(result.config);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white text-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Framework Configuration</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure note eligibility per Outlook / Risk / Goal cell. Saving triggers a background pre-calc refresh.
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-3xl leading-none font-light">×</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3 bg-slate-50 border-b border-slate-200">
          {(["buckets", "Bullish", "Neutral", "Bearish"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-blue-600 text-blue-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {tab === "buckets" ? "Outlook Buckets" : tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── Outlook Buckets tab ───────────────────────────────────────── */}
          {activeTab === "buckets" && (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                Which asset buckets are reduced when computing portfolio metrics for each market outlook.
                This drives the pre-calculation math.
              </p>
              {OUTLOOKS.map((outlook) => (
                <div key={outlook} className="bg-slate-50 rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-700 mb-3">{outlook}</p>
                  <div className="flex flex-wrap gap-5">
                    {BUCKETS.map((bucket) => {
                      const checked = (config.outlook_buckets[outlook] ?? []).includes(bucket);
                      return (
                        <label key={bucket} className="flex items-center gap-2 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => updateBucket(outlook, bucket, e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-sm text-slate-700">{bucket}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Per-outlook 3×3 grid tabs ─────────────────────────────────── */}
          {(["Bullish", "Neutral", "Bearish"] as const).map((outlook) =>
            activeTab !== outlook ? null : (
              <div key={outlook} className="space-y-3">
                {/* Column headers */}
                <div className="grid grid-cols-4 gap-3">
                  <div />
                  {GOALS.map((g) => (
                    <div key={g} className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wide py-1">
                      Goal: {g}
                    </div>
                  ))}
                </div>

                {/* Grid rows */}
                {RISKS.map((risk) => (
                  <div key={risk} className="grid grid-cols-4 gap-3 items-start">
                    {/* Row label */}
                    <div className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wide pt-3 pr-2">
                      {risk}
                    </div>

                    {/* Three goal cells */}
                    {GOALS.map((goal) => {
                      const key  = `${outlook}|${risk}|${goal}`;
                      const cell = config.cells[key];
                      const isExpanded = expandedCell === key;

                      if (!cell) {
                        return (
                          <div key={key} className="rounded-xl border border-slate-200 bg-slate-100 h-16 flex items-center justify-center text-xs text-slate-400">
                            no config
                          </div>
                        );
                      }

                      return (
                        <div
                          key={key}
                          className={`rounded-xl border transition-all ${
                            isExpanded
                              ? "border-blue-400 shadow-sm"
                              : "border-slate-200 hover:border-blue-300"
                          }`}
                        >
                          {/* Summary card — click to expand */}
                          <button
                            onClick={() => setExpanded(isExpanded ? null : key)}
                            className="w-full text-left px-3 py-2.5"
                          >
                            <div className="text-xs font-semibold text-slate-700 leading-snug">
                              {cell.allowed_types.length > 0
                                ? cell.allowed_types.join(", ")
                                : <span className="text-slate-400 font-normal">All types</span>}
                            </div>
                            <div className="text-xs text-slate-400 mt-0.5">
                              Max {cell.max_alloc_pct}% · Prot {cell.min_protection_pct}–{cell.max_protection_pct}%
                            </div>
                            <div className="text-xs text-blue-500 mt-0.5">{isExpanded ? "▲ collapse" : "▼ edit"}</div>
                          </button>

                          {/* Inline editor */}
                          {isExpanded && (
                            <div className="border-t border-blue-200 bg-blue-50 px-3 py-3 space-y-3 rounded-b-xl">

                              {/* Allowed note types */}
                              <div>
                                <p className="text-xs font-semibold text-slate-600 mb-1.5">Allowed Note Types</p>
                                <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                                  {ALL_TYPES.map((t) => (
                                    <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={cell.allowed_types.includes(t)}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...cell.allowed_types, t]
                                            : cell.allowed_types.filter((x) => x !== t);
                                          updateCell(key, { allowed_types: next });
                                        }}
                                        className="w-3.5 h-3.5 rounded"
                                      />
                                      <span className="text-xs text-slate-700">{t}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>

                              {/* Protection range */}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="text-xs font-semibold text-slate-600 block mb-1">Min Protection %</label>
                                  <input
                                    type="number" min={0} max={100} step={1}
                                    value={cell.min_protection_pct}
                                    onChange={(e) => updateCell(key, { min_protection_pct: Number(e.target.value) })}
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-semibold text-slate-600 block mb-1">Max Protection %</label>
                                  <input
                                    type="number" min={0} max={100} step={1}
                                    value={cell.max_protection_pct}
                                    onChange={(e) => updateCell(key, { max_protection_pct: Number(e.target.value) })}
                                    className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  />
                                </div>
                              </div>

                              {/* Max allocation */}
                              <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">Max Allocation %</label>
                                <input
                                  type="number" min={0} max={100} step={0.5}
                                  value={cell.max_alloc_pct}
                                  onChange={(e) => updateCell(key, { max_alloc_pct: Number(e.target.value) })}
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>

                              {/* Allowed underlyings */}
                              <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                  Allowed Underlyings{" "}
                                  <span className="font-normal text-slate-400">(comma-sep, empty&nbsp;=&nbsp;any)</span>
                                </label>
                                <input
                                  type="text"
                                  value={cell.allowed_underlyings.join(", ")}
                                  onChange={(e) => {
                                    const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                                    updateCell(key, { allowed_underlyings: vals });
                                  }}
                                  placeholder="e.g. SPX, RUT"
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                />
                              </div>

                              {/* Allowed protection types */}
                              <div>
                                <label className="text-xs font-semibold text-slate-600 block mb-1">
                                  Allowed Protection Types{" "}
                                  <span className="font-normal text-slate-400">(comma-sep, empty&nbsp;=&nbsp;any)</span>
                                </label>
                                <input
                                  type="text"
                                  value={cell.allowed_protection_types.join(", ")}
                                  onChange={(e) => {
                                    const vals = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                                    updateCell(key, { allowed_protection_types: vals });
                                  }}
                                  placeholder="e.g. Soft, Hard"
                                  className="w-full border border-slate-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && !error && (
              <p className="text-sm text-green-600">✓ Saved — pre-calc is being refreshed in the background</p>
            )}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleReset}
              disabled={resetting || saving}
              className="border border-amber-300 text-amber-700 font-semibold py-2 px-4 rounded-lg text-sm hover:bg-amber-50 transition-colors disabled:opacity-50"
            >
              {resetting ? "Resetting…" : "Reset to Defaults"}
            </button>
            <button
              onClick={onClose}
              className="border border-slate-300 text-slate-600 font-semibold py-2 px-4 rounded-lg text-sm hover:bg-slate-100 transition-colors"
            >
              Close
            </button>
            <button
              onClick={handleSave}
              disabled={saving || resetting}
              className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 px-6 rounded-lg text-sm transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {saving && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
              {saving ? "Saving…" : "Save & Apply"}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
