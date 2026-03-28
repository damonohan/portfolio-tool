"use client";

import React, { useState, useEffect, useRef } from "react";
import { api, Improvement } from "@/lib/api";
import dynamic from "next/dynamic";
import ImprovementDetail from "./ImprovementDetail";

// Plotly must be loaded client-side only
const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface BaseMetrics {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  expected_income_pct: number;
}

interface Framework {
  outlook: string;
  risk_tolerance: string;
  goal: string;
  portfolio_name: string;
  horizon: number;
}

interface Props {
  framework: Framework;
}

export default function Screen5Improvements({ framework }: Props) {
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState("");
  const [baseMetrics, setBaseMetrics]   = useState<BaseMetrics | null>(null);
  const [improvements, setImprovements] = useState<Improvement[]>([]);
  const [histograms, setHistograms]     = useState<Record<number, { data: unknown[]; layout: unknown }>>({});
  const [loadingHist, setLoadingHist]   = useState<Record<number, boolean>>({});
  const [expandedIdx, setExpandedIdx]   = useState<number | null>(null);
  const [detailIdx, setDetailIdx]       = useState<number | null>(null);
  const exportRef = useRef<HTMLAnchorElement>(null);

  const run = async () => {
    setLoading(true);
    setError("");
    setImprovements([]);
    setHistograms({});
    setExpandedIdx(null);
    try {
      const res = await api.findImprovements({
        portfolio_name: framework.portfolio_name,
        outlook:        framework.outlook,
        risk_tolerance: framework.risk_tolerance,
        goal:           framework.goal,
        horizon:        framework.horizon,
      });
      setBaseMetrics(res.base);
      setImprovements(res.improvements);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to find improvements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { run(); }, []); // auto-run on mount

  const loadHistogram = async (idx: number) => {
    if (histograms[idx]) { setExpandedIdx(idx === expandedIdx ? null : idx); return; }
    setLoadingHist((prev) => ({ ...prev, [idx]: true }));
    try {
      const data = await api.getHistogram(idx);
      setHistograms((prev) => ({ ...prev, [idx]: data as { data: unknown[]; layout: unknown } }));
      setExpandedIdx(idx);
    } catch {
      setError("Failed to load histogram");
    } finally {
      setLoadingHist((prev) => ({ ...prev, [idx]: false }));
    }
  };

  const exportCsv = () => { window.open(api.exportCsvUrl(), "_blank"); };
  const exportPdf = () => { window.open(api.exportPdfUrl(), "_blank"); };

  const Delta = ({ val, base, lower = false }: { val: number; base: number; lower?: boolean }) => {
    const diff = val - base;
    const good = lower ? diff <= 0 : diff >= 0;
    return (
      <span className={`ml-1 text-xs ${good ? "text-green-600" : "text-red-500"}`}>
        ({diff >= 0 ? "+" : ""}{diff.toFixed(4)})
      </span>
    );
  };

  return (
    <>
    {detailIdx !== null && baseMetrics && (
      <ImprovementDetail
        index={detailIdx}
        improvement={improvements[detailIdx]}
        baseMetrics={baseMetrics}
        onClose={() => setDetailIdx(null)}
      />
    )}

    <div className="max-w-6xl mx-auto space-y-6">

      {/* Framework reminder */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-5 py-3 text-sm text-blue-800 flex flex-wrap gap-4">
        <span><strong>Outlook:</strong> {framework.outlook}</span>
        <span><strong>Risk:</strong> {framework.risk_tolerance}</span>
        <span><strong>Goal:</strong> {framework.goal}</span>
        <span><strong>Portfolio:</strong> {framework.portfolio_name}</span>
        <span><strong>Horizon:</strong> {framework.horizon}yr</span>
      </div>

      {/* Base summary */}
      {baseMetrics && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
          <h3 className="text-base font-bold text-slate-800 mb-3">Base Portfolio Metrics</h3>
          <div className="grid grid-cols-5 gap-4">
            {[
              { label: "Sharpe Ratio", value: baseMetrics.sharpe.toFixed(4) },
              { label: "% Negative", value: `${baseMetrics.pct_neg.toFixed(2)}%` },
              { label: "Shorty (Ex. Kurt.)", value: baseMetrics.shorty.toFixed(4) },
              { label: "D. Kurt. (Downside)", value: (baseMetrics.downside_kurt ?? 0).toFixed(4) },
              { label: "Expected Income", value: `${baseMetrics.expected_income_pct.toFixed(2)}%` },
            ].map((m) => (
              <div key={m.label} className="bg-slate-50 rounded-lg border border-slate-200 p-3 text-center">
                <div className="text-xl font-bold text-blue-700">{m.value}</div>
                <div className="text-xs text-slate-500 mt-0.5 font-medium">{m.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Find button & loading */}
      <div className="flex items-center gap-4">
        <button
          onClick={run}
          disabled={loading}
          className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {loading && <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />}
          {loading ? "Searching…" : "Find Single-Note Improvements"}
        </button>

        {improvements.length > 0 && (
          <div className="flex gap-2 ml-auto">
            <button onClick={exportCsv} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-lg text-sm transition-colors">
              ⬇ Export CSV
            </button>
            <button onClick={exportPdf} className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold py-2 px-4 rounded-lg text-sm transition-colors">
              ⬇ Export PDF
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Results */}
      {improvements.length === 0 && !loading && baseMetrics && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-5 py-4 text-sm">
          No improvements found under the current framework. Try adjusting the outlook, risk tolerance, or goal.
        </div>
      )}

      {improvements.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50">
            <span className="font-semibold text-slate-700">Top {improvements.length} Improvement Candidate{improvements.length > 1 ? "s" : ""}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Rank</th>
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Note ID</th>
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Type</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Alloc %</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">New Sharpe</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">New %Neg</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">New Shorty</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">New D.Kurt</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Income Boost</th>
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Score</th>
                  <th className="px-4 py-3 text-center font-semibold bg-slate-50 text-slate-500 text-xs uppercase">Chart</th>
                </tr>
              </thead>
              <tbody>
                {improvements.map((imp, idx) => (
                  <React.Fragment key={imp.note_id}>
                    <tr className={`border-b border-slate-100 hover:bg-slate-50 ${idx === expandedIdx ? "bg-blue-50" : ""}`}>
                      <td className="px-4 py-3 font-bold text-blue-700">#{idx + 1}</td>
                      <td className="px-4 py-3 font-mono font-semibold text-slate-800">{imp.note_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          imp.note_type === "Income" ? "bg-green-100 text-green-700"
                          : imp.note_type === "Growth" ? "bg-blue-100 text-blue-700"
                          : imp.note_type === "Digital" ? "bg-purple-100 text-purple-700"
                          : imp.note_type === "Absolute" ? "bg-slate-100 text-slate-700"
                          : imp.note_type === "Snowball" ? "bg-rose-100 text-rose-700"
                          : "bg-orange-100 text-orange-700"
                        }`}>{imp.note_type}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{imp.alloc_pct}%</td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        {imp.new_sharpe.toFixed(4)}
                        {baseMetrics && <Delta val={imp.new_sharpe} base={baseMetrics.sharpe} />}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        {imp.new_pct_neg.toFixed(2)}%
                        {baseMetrics && <Delta val={imp.new_pct_neg} base={baseMetrics.pct_neg} lower />}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        {imp.new_shorty.toFixed(4)}
                        {baseMetrics && <Delta val={imp.new_shorty} base={baseMetrics.shorty} lower />}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-800">
                        {(imp.new_downside_kurt ?? 0).toFixed(4)}
                        {baseMetrics && <Delta val={imp.new_downside_kurt ?? 0} base={baseMetrics.downside_kurt ?? 0} lower />}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {imp.income_boost > 0
                          ? <span className="text-green-600 font-semibold">+{(imp.income_boost * 100).toFixed(4)}%</span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-slate-600">{imp.score.toFixed(4)}</td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setDetailIdx(idx)}
                          className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-3 py-1.5 rounded-lg transition-colors"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                    {expandedIdx === idx && histograms[idx] && (
                      <tr>
                        <td colSpan={11} className="px-4 py-4 bg-slate-50">
                          <Plot
                            data={histograms[idx].data as Plotly.Data[]}
                            layout={{
                              ...(histograms[idx].layout as object),
                              autosize: true,
                              margin: { l: 50, r: 20, t: 50, b: 40 },
                            }}
                            style={{ width: "100%", height: 380 }}
                            config={{ responsive: true, displayModeBar: true }}
                          />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <a ref={exportRef} className="hidden" />
    </div>
    </>
  );
}
