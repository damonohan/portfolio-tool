"use client";

import { useState, useCallback } from "react";
import { api } from "@/lib/api";

interface Props {
  onContinue: (data: {
    assetCols: string[];
    noteIds: string[];
    restoredPortfolios: number;
    restoredNoteMeta: boolean;
    restoredAssetMeta: boolean;
  }) => void;
}

export default function Screen1Upload({ onContinue }: Props) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{
    asset_cols: string[];
    note_ids: string[];
    row_count: number;
    restored_portfolios: number;
    restored_note_meta: boolean;
    restored_asset_meta: boolean;
    preview: Record<string, unknown>[];
  } | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith(".xlsx")) {
      setError("Only .xlsx files are accepted.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await api.upload(file);
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-1">Upload Simulation File</h2>
        <p className="text-sm text-slate-500 mb-5">
          Upload a Monte Carlo simulation Excel (.xlsx) file with asset class and note columns.
        </p>

        {/* Drop zone */}
        <label
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-12 cursor-pointer transition-colors ${
            dragging
              ? "border-blue-500 bg-blue-50"
              : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className="text-4xl mb-3">📂</div>
          <div className="text-base font-semibold text-slate-700">
            Drag & drop your .xlsx file here
          </div>
          <div className="text-sm text-slate-500 mt-1">or click to browse</div>
          <input
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
        </label>

        {loading && (
          <div className="mt-4 flex items-center gap-2 text-blue-700">
            <div className="animate-spin w-4 h-4 border-2 border-blue-700 border-t-transparent rounded-full" />
            Parsing file…
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}
      </div>

      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
            <span className="text-2xl">✅</span>
            <span className="font-semibold text-green-800">
              Detected {result.asset_cols.length} asset classes and {result.note_ids.length} notes
              &nbsp;·&nbsp; {result.row_count.toLocaleString()} rows
            </span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Asset Classes</p>
              <ul className="text-sm space-y-1">
                {result.asset_cols.map((a) => (
                  <li key={a} className="bg-blue-50 text-blue-800 px-2 py-1 rounded">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-2">Notes Detected</p>
              <ul className="text-sm space-y-1">
                {result.note_ids.map((n) => (
                  <li key={n} className="bg-orange-50 text-orange-800 px-2 py-1 rounded">
                    ID: {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Preview table */}
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Preview (first 10 rows)</p>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="text-xs w-full min-w-max">
                <thead>
                  <tr>
                    {Object.keys(result.preview[0] ?? {}).map((k) => (
                      <th key={k} className="px-2 py-2 text-left font-semibold bg-slate-50 border-b border-slate-200 whitespace-nowrap text-slate-500">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.preview.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "" : "bg-slate-50"}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} className="px-2 py-1.5 border-b border-slate-100 whitespace-nowrap">
                          {v === null || v === undefined
                            ? "—"
                            : typeof v === "number"
                            ? v.toFixed(5)
                            : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {result.restored_portfolios > 0 && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-3 rounded-lg">
              <span className="text-lg">✓</span>
              <span>
                <strong>{result.restored_portfolios} portfolio{result.restored_portfolios > 1 ? "s" : ""}</strong> restored from a previous session with this file.
                {result.restored_note_meta && " Note classifications also restored."}
                {result.restored_asset_meta && " Asset metadata also restored."}
              </span>
            </div>
          )}

          <button
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
            onClick={() =>
              onContinue({
                assetCols:          result.asset_cols,
                noteIds:            result.note_ids,
                restoredPortfolios: result.restored_portfolios,
                restoredNoteMeta:   result.restored_note_meta,
                restoredAssetMeta:  result.restored_asset_meta,
              })
            }
          >
            {result.restored_portfolios > 0 ? "Resume Session →" : "Confirm & Continue →"}
          </button>
        </div>
      )}
    </div>
  );
}
