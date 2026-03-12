"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

interface Allocation { asset: string; weight_pct: number; }
interface PortfolioStats {
  name: string;
  allocations: Allocation[];
  sharpe: number;
  pct_neg: number;
  shorty: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}
interface NoteInfo { note_id: string; note_type: string; yield_pct: number; }

interface Props {
  onContinue: () => void;
}

const TYPE_COLORS: Record<string, string> = {
  Income:   "bg-green-100 text-green-700",
  Growth:   "bg-blue-100 text-blue-700",
  Digital:  "bg-purple-100 text-purple-700",
  Absolute: "bg-slate-100 text-slate-600",
  MLCD:     "bg-yellow-100 text-yellow-700",
  PPN:      "bg-orange-100 text-orange-700",
};

export default function Screen4PortfolioSummary({ onContinue }: Props) {
  const [portfolios, setPortfolios] = useState<PortfolioStats[]>([]);
  const [notes,      setNotes]      = useState<NoteInfo[]>([]);
  const [horizon,    setHorizon]    = useState(1);
  const [riskFree,   setRiskFree]   = useState(2.0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState("");

  const load = async (h = horizon, rf = riskFree) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.portfolioSummary(h, rf);
      setPortfolios(data.portfolios);
      setNotes(data.notes);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleHorizonChange = (h: number) => { setHorizon(h); load(h, riskFree); };
  const handleRfChange      = (rf: number) => { setRiskFree(rf); load(horizon, rf); };

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Controls */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 px-6 py-4 flex flex-wrap items-center gap-6">
        <span className="text-sm font-semibold text-slate-600">Preview stats using:</span>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Horizon
          <select
            value={horizon}
            onChange={(e) => handleHorizonChange(Number(e.target.value))}
            className="border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1 Year</option>
            <option value={2}>2 Years</option>
            <option value={3}>3 Years</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Risk-Free Rate
          <input
            type="number"
            min={0}
            max={20}
            step={0.1}
            value={riskFree}
            onChange={(e) => handleRfChange(parseFloat(e.target.value) || 0)}
            className="border border-slate-300 rounded-lg px-2 py-1 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-slate-500">%</span>
        </label>
        {loading && <span className="text-xs text-slate-400 animate-pulse">Recalculating…</span>}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Portfolio cards */}
      {portfolios.map((port) => (
        <div key={port.name} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Card header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <h3 className="text-base font-bold text-slate-800">{port.name}</h3>
            {/* Stat pills */}
            <div className="flex flex-wrap gap-3">
              {[
                { label: "Sharpe",          value: port.sharpe.toFixed(3) },
                { label: "% Negative",      value: `${port.pct_neg.toFixed(1)}%` },
                { label: "Shorty",          value: port.shorty.toFixed(3) },
                { label: "Expected Income", value: `${port.expected_income_pct.toFixed(2)}%` },
                { label: "Mean Return",     value: `${(port.mean * 100).toFixed(2)}%` },
              ].map((s) => (
                <div key={s.label} className="text-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 min-w-[80px]">
                  <div className="text-sm font-bold text-blue-700">{s.value}</div>
                  <div className="text-xs text-slate-400 leading-tight">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Allocation table */}
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Asset Allocation</p>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
              {port.allocations.map((a) => (
                <div key={a.asset} className="flex items-center gap-2">
                  {/* Bar */}
                  <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden flex-shrink-0">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(a.weight_pct, 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-10 text-right flex-shrink-0">
                    {a.weight_pct}%
                  </span>
                  <span className="text-xs text-slate-500 truncate">{a.asset}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Notes available for analysis */}
      {notes.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
            Notes Available for Improvement Analysis ({notes.length})
          </p>
          <div className="flex flex-wrap gap-2">
            {notes.map((n) => (
              <div
                key={n.note_id}
                className="flex items-center gap-1.5 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <span className="font-mono font-semibold text-slate-700">{n.note_id}</span>
                <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${TYPE_COLORS[n.note_type] ?? "bg-slate-100 text-slate-600"}`}>
                  {n.note_type}
                </span>
                {n.note_type === "Income" && (
                  <span className="text-xs text-green-600 font-medium">{n.yield_pct}%</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {portfolios.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={onContinue}
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-8 rounded-lg transition-colors"
          >
            Select Framework & Run Analysis →
          </button>
        </div>
      )}
    </div>
  );
}
