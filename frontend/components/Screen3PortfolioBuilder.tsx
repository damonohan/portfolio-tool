"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const BUCKETS = ["Equity", "Fixed Income", "Alternative", "Cash"] as const;

interface Props {
  assetCols: string[];
  noteIds: string[];
  noteMeta: Record<string, { type: string; yield_pct: number }>;
  onContinue: () => void;
}

interface AssetMeta {
  asset: string;
  yield_pct: number;
  bucket: string;
}

interface Portfolio {
  name: string;
  asset_count: number;
  weights: Record<string, number>;
  risk_free: number;
}

export default function Screen3PortfolioBuilder({
  assetCols,
  noteIds,
  noteMeta,
  onContinue,
}: Props) {
  const [assetMeta, setAssetMeta] = useState<AssetMeta[]>(
    assetCols.map((a) => ({ asset: a, yield_pct: 0, bucket: "" }))
  );
  const [metaSaved, setMetaSaved]   = useState(false);
  const [metaError, setMetaError]   = useState("");

  // Portfolio form
  const [portName,        setPortName]        = useState("");
  const [riskFree,        setRiskFree]        = useState(2.0);
  const [selectedAssets,  setSelectedAssets]  = useState<string[]>([]);
  const [weights,         setWeights]         = useState<Record<string, number>>({});
  const [portfolios,      setPortfolios]      = useState<Portfolio[]>([]);
  const [portfolioOrder,  setPortfolioOrder]  = useState<string[]>([]);
  const [editingPortfolio,setEditingPortfolio]= useState<string | null>(null); // original name when editing
  const [portError,       setPortError]       = useState("");
  const [portSuccess,     setPortSuccess]     = useState("");
  const [loading,         setLoading]         = useState(false);
  const [fingerprint,     setFingerprint]     = useState<string>("");

  const incomeNotes = noteIds.filter((id) => noteMeta[id]?.type === "Income");

  // ── Merge fetched portfolios with stored sort order ───────────────────────
  const applyOrder = (ps: Portfolio[], order: string[]) => {
    const byName = Object.fromEntries(ps.map((p) => [p.name, p]));
    const ordered = order.filter((n) => byName[n]).map((n) => byName[n]);
    const rest    = ps.filter((p) => !order.includes(p.name));
    return [...ordered, ...rest];
  };

  useEffect(() => {
    api.getPortfolios().then((ps) => {
      if (ps.length > 0 && ps[0].risk_free != null) setRiskFree(ps[0].risk_free);
      setPortfolios(ps);
      setPortfolioOrder(ps.map((p) => p.name));
    }).catch(() => {});

    api.sessionState().then((state) => {
      const fp      = state.fingerprint ?? "";
      const yields  = state.asset_yields  ?? {};
      const buckets = state.asset_buckets ?? {};
      setFingerprint(fp);
      if (Object.keys(buckets).length > 0) {
        setAssetMeta(assetCols.map((a) => ({
          asset:     a,
          yield_pct: yields[a]  ?? 0,
          bucket:    buckets[a] ?? "",
        })));
        setMetaSaved(true);
      }
      // Restore saved order from localStorage
      if (fp) {
        try {
          const stored = localStorage.getItem(`portfolioOrder_${fp}`);
          if (stored) {
            const order: string[] = JSON.parse(stored);
            setPortfolioOrder(order);
            api.getPortfolios().then((ps) => setPortfolios(applyOrder(ps, order))).catch(() => {});
          }
        } catch { /* ignore */ }
      }
    }).catch(() => {});
  }, [assetCols]);

  const persistOrder = (order: string[]) => {
    setPortfolioOrder(order);
    if (fingerprint) {
      try { localStorage.setItem(`portfolioOrder_${fingerprint}`, JSON.stringify(order)); }
      catch { /* ignore */ }
    }
  };

  const reorder = (name: string, dir: -1 | 1) => {
    setPortfolios((prev) => {
      const idx = prev.findIndex((p) => p.name === name);
      if (idx < 0) return prev;
      const next = dir === -1 ? idx - 1 : idx + 1;
      if (next < 0 || next >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[next]] = [arr[next], arr[idx]];
      persistOrder(arr.map((p) => p.name));
      return arr;
    });
  };

  // ── Load a portfolio into the form for editing ────────────────────────────
  const startEdit = (p: Portfolio) => {
    setEditingPortfolio(p.name);
    setPortName(p.name);
    setRiskFree(p.risk_free ?? 2.0);
    const nonZero = Object.entries(p.weights)
      .filter(([, w]) => w > 0)
      .reduce<Record<string, number>>((acc, [k, v]) => { acc[k] = v; return acc; }, {});
    setSelectedAssets(Object.keys(nonZero));
    setWeights(nonZero);
    setPortError("");
    setPortSuccess("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditingPortfolio(null);
    setPortName("");
    setSelectedAssets([]);
    setWeights({});
    setPortError("");
    setPortSuccess("");
  };

  // ── Asset metadata ────────────────────────────────────────────────────────
  const updateMeta = (idx: number, field: keyof AssetMeta, value: string | number) => {
    setMetaSaved(false);
    setAssetMeta((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  const saveMeta = async () => {
    const missing = assetMeta.filter((a) => !a.bucket);
    if (missing.length > 0) {
      setMetaError(`Assign buckets to: ${missing.map((a) => a.asset).join(", ")}`);
      return;
    }
    setLoading(true);
    setMetaError("");
    try {
      await api.setAssetMetadata(assetMeta);
      setMetaSaved(true);
    } catch (e: unknown) {
      setMetaError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  // ── Portfolio form ────────────────────────────────────────────────────────
  const toggleAsset = (a: string) => {
    setSelectedAssets((prev) => {
      const next = prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a];
      setWeights((w) => {
        const nw = { ...w };
        if (prev.includes(a)) delete nw[a];
        else nw[a] = 0;
        return nw;
      });
      return next;
    });
    setPortError("");
    setPortSuccess("");
  };

  const setWeight = (asset: string, val: number) => {
    setWeights((w) => ({ ...w, [asset]: val }));
  };

  const weightTotal = Object.values(weights).reduce((s, v) => s + v, 0);

  const savePortfolio = async () => {
    if (!portName.trim()) { setPortError("Enter a portfolio name."); return; }
    if (selectedAssets.length === 0) { setPortError("Select at least one asset."); return; }
    if (Math.abs(weightTotal - 100) > 0.01) {
      setPortError(`Weights must sum to 100%. Currently: ${weightTotal.toFixed(2)}%`);
      return;
    }
    setLoading(true);
    setPortError("");
    try {
      const newName = portName.trim();
      // If renaming (editing and name changed), delete the old entry first
      if (editingPortfolio && editingPortfolio !== newName) {
        await api.deletePortfolio(editingPortfolio);
      }
      await api.savePortfolio(newName, weights, riskFree);
      setPortSuccess(
        editingPortfolio
          ? `Portfolio "${newName}" updated.`
          : `Portfolio "${newName}" saved.`
      );
      setEditingPortfolio(null);
      setPortName("");
      setSelectedAssets([]);
      setWeights({});
      const ps = await api.getPortfolios();
      // Merge new list with current display order, appending new entries
      setPortfolios((prev) => {
        const currentOrder = prev.map((p) =>
          editingPortfolio && p.name === editingPortfolio ? newName : p.name
        );
        const newOrder = [
          ...currentOrder,
          ...ps.map((p) => p.name).filter((n) => !currentOrder.includes(n)),
        ];
        persistOrder(newOrder);
        return applyOrder(ps, newOrder);
      });
    } catch (e: unknown) {
      setPortError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  const deletePortfolio = async (name: string) => {
    try {
      await api.deletePortfolio(name);
      setPortfolios((prev) => {
        const next = prev.filter((p) => p.name !== name);
        persistOrder(next.map((p) => p.name));
        return next;
      });
      if (editingPortfolio === name) cancelEdit();
    } catch (e: unknown) {
      setPortError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* Section A: Yields */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-1">A — Asset Expected Yields</h2>
        <p className="text-sm text-slate-500 mb-4">Enter the expected annual yield (%) for each asset class.</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">Asset Class</th>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">Expected Annual Yield (%)</th>
              </tr>
            </thead>
            <tbody>
              {assetMeta.map((row, idx) => (
                <tr key={row.asset} className={idx % 2 === 0 ? "" : "bg-slate-50"}>
                  <td className="px-4 py-2.5 border-b border-slate-100 font-medium">{row.asset}</td>
                  <td className="px-4 py-2.5 border-b border-slate-100">
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={row.yield_pct}
                      onChange={(e) => updateMeta(idx, "yield_pct", parseFloat(e.target.value) || 0)}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {incomeNotes.length > 0 && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-xs font-semibold text-orange-700 mb-1">Income Notes (for reference)</p>
            <div className="flex flex-wrap gap-2">
              {incomeNotes.map((id) => (
                <span key={id} className="text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
                  {id}: {noteMeta[id]?.yield_pct ?? 0}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section B: Buckets */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-1">B — Economic Bucket Assignment</h2>
        <p className="text-sm text-slate-500 mb-4">Assign each asset to exactly one economic bucket.</p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">Asset Class</th>
                {BUCKETS.map((b) => (
                  <th key={b} className="px-3 py-3 text-center font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">{b}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {assetMeta.map((row, idx) => (
                <tr key={row.asset} className={idx % 2 === 0 ? "" : "bg-slate-50"}>
                  <td className="px-4 py-2.5 border-b border-slate-100 font-medium">{row.asset}</td>
                  {BUCKETS.map((b) => (
                    <td key={b} className="px-3 py-2.5 border-b border-slate-100 text-center">
                      <input
                        type="radio"
                        name={`bucket-${row.asset}`}
                        checked={row.bucket === b}
                        onChange={() => updateMeta(idx, "bucket", b)}
                        className="accent-blue-700 w-4 h-4"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {metaError && (
          <div className="mt-3 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{metaError}</div>
        )}
        {metaSaved && (
          <div className="mt-3 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">Asset metadata saved.</div>
        )}
        <button
          onClick={saveMeta}
          disabled={loading}
          className="mt-4 bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm"
        >
          Save Yields &amp; Buckets
        </button>
      </div>

      {/* Section C: Portfolio creation */}
      <div className={`bg-white rounded-xl shadow-sm border border-slate-200 p-6 ${!metaSaved ? "opacity-50 pointer-events-none" : ""}`}>
        <h2 className="text-lg font-bold text-slate-800 mb-1">C — Portfolio Creation</h2>
        {!metaSaved && (
          <p className="text-sm text-orange-600 mb-4">Save yields &amp; buckets above before creating portfolios.</p>
        )}
        <p className="text-sm text-slate-500 mb-4">Build and save portfolios using asset classes only.</p>

        <div className="grid grid-cols-3 gap-6">
          {/* Sidebar: saved portfolios with reorder + edit */}
          <div className="col-span-1">
            <p className="text-sm font-semibold text-slate-600 mb-2">
              Saved Portfolios
              <span className="ml-1 text-xs font-normal text-slate-400">(drag ↕ to reorder)</span>
            </p>
            {portfolios.length === 0 ? (
              <p className="text-xs text-slate-400 italic">None yet.</p>
            ) : (
              <ul className="space-y-2">
                {portfolios.map((p, idx) => (
                  <li
                    key={p.name}
                    className={`border rounded-lg px-3 py-2 transition-colors ${
                      editingPortfolio === p.name
                        ? "border-blue-400 bg-blue-50"
                        : "bg-slate-50 border-slate-200"
                    }`}
                  >
                    <div className="flex items-start gap-1">
                      {/* Reorder arrows */}
                      <div className="flex flex-col gap-0.5 pt-0.5 shrink-0">
                        <button
                          onClick={() => reorder(p.name, -1)}
                          disabled={idx === 0}
                          className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs leading-none"
                          title="Move up"
                        >▲</button>
                        <button
                          onClick={() => reorder(p.name, 1)}
                          disabled={idx === portfolios.length - 1}
                          className="text-slate-300 hover:text-slate-600 disabled:opacity-20 text-xs leading-none"
                          title="Move down"
                        >▼</button>
                      </div>

                      {/* Name + meta */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.asset_count} assets · RFR: {p.risk_free ?? 2.0}%</p>
                      </div>

                      {/* Edit + delete */}
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => startEdit(p)}
                          title="Edit portfolio"
                          className="text-xs text-blue-500 hover:text-blue-700 px-1"
                        >✎</button>
                        <button
                          onClick={() => deletePortfolio(p.name)}
                          title="Delete portfolio"
                          className="text-xs text-red-400 hover:text-red-600 px-1"
                        >✕</button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Portfolio form */}
          <div className="col-span-2 space-y-4">
            {/* Edit banner */}
            {editingPortfolio && (
              <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
                <span className="text-sm font-semibold text-blue-800">Editing: {editingPortfolio}</span>
                <button onClick={cancelEdit} className="text-xs text-blue-500 hover:text-blue-700">Cancel</button>
              </div>
            )}

            <div className="flex gap-4">
              <div className="flex-1">
                <label className="text-sm font-medium text-slate-600 mb-1 block">
                  Portfolio Name {editingPortfolio && <span className="text-xs font-normal text-slate-400">(rename by changing this)</span>}
                </label>
                <input
                  type="text"
                  value={portName}
                  onChange={(e) => setPortName(e.target.value)}
                  placeholder="e.g. Conservative Balanced"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="w-36">
                <label className="text-sm font-medium text-slate-600 mb-1 block">Risk-Free Rate (%)</label>
                <input
                  type="number"
                  min={0}
                  max={20}
                  step={0.1}
                  value={riskFree}
                  onChange={(e) => setRiskFree(parseFloat(e.target.value) || 0)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-600 mb-2">Select Assets &amp; Assign Weights</p>
              <div className="space-y-2">
                {assetCols.map((a) => {
                  const sel = selectedAssets.includes(a);
                  return (
                    <div key={a} className={`flex items-center gap-3 p-2.5 rounded-lg border ${sel ? "border-blue-300 bg-blue-50" : "border-slate-200"}`}>
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={() => toggleAsset(a)}
                        className="accent-blue-700 w-4 h-4 flex-shrink-0"
                      />
                      <span className="text-sm font-medium text-slate-700 flex-1 min-w-0 truncate">{a}</span>
                      {sel && (
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={weights[a] ?? 0}
                            onChange={(e) => setWeight(a, Number(e.target.value))}
                            className="w-24 accent-blue-700"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={5}
                            value={weights[a] ?? 0}
                            onChange={(e) => setWeight(a, parseFloat(e.target.value) || 0)}
                            className="w-16 border border-slate-300 rounded px-1.5 py-1 text-xs"
                          />
                          <span className="text-xs text-slate-500">%</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {selectedAssets.length > 0 && (
                <div className={`mt-2 text-sm font-semibold ${Math.abs(weightTotal - 100) < 0.01 ? "text-green-600" : "text-orange-600"}`}>
                  Total: {weightTotal.toFixed(2)}% {Math.abs(weightTotal - 100) < 0.01 ? "✓" : "(must equal 100%)"}
                </div>
              )}
            </div>

            {portError && (
              <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{portError}</div>
            )}
            {portSuccess && (
              <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">{portSuccess}</div>
            )}

            <div className="flex gap-3">
              <button
                onClick={savePortfolio}
                disabled={loading || !metaSaved}
                className="bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2 px-5 rounded-lg transition-colors disabled:opacity-50 text-sm"
                title={!metaSaved ? "Save yields & buckets first" : undefined}
              >
                {loading ? "Saving…" : editingPortfolio ? "Update Portfolio" : "Save Portfolio"}
              </button>
              {portfolios.length > 0 && metaSaved && (
                <button
                  onClick={onContinue}
                  className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm"
                >
                  Continue to Analysis →
                </button>
              )}
            </div>
            {portfolios.length > 0 && !metaSaved && (
              <p className="text-xs text-orange-600">Save yields &amp; buckets before continuing.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
