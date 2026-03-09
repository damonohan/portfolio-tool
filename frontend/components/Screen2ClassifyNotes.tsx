"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const NOTE_TYPES = ["Income", "Growth", "Digital", "Absolute", "MLCD", "PPN"] as const;

interface NoteRow {
  note_id: string;
  note_type: string;
  yield_pct: number;
}

interface Props {
  noteIds: string[];
  onContinue: () => void;
}

export default function Screen2ClassifyNotes({ noteIds, onContinue }: Props) {
  const [rows, setRows] = useState<NoteRow[]>(
    noteIds.map((id) => ({ note_id: id, note_type: "", yield_pct: 0 }))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  // Pre-populate from saved session state when navigating back
  useEffect(() => {
    api.sessionState().then((state) => {
      const meta = state.note_meta ?? {};
      if (Object.keys(meta).length === 0) return;
      setRows(noteIds.map((id) => ({
        note_id:   id,
        note_type: meta[id]?.type ?? "",
        yield_pct: meta[id]?.yield_pct ?? 0,
      })));
      setSaved(true);
    }).catch(() => {});
  }, [noteIds]);

  const update = (idx: number, field: keyof NoteRow, value: string | number) => {
    setSaved(false);
    setRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r))
    );
  };

  const handleSave = async () => {
    const unclassified = rows.filter((r) => !r.note_type);
    if (unclassified.length > 0) {
      setError(`Please classify all notes. Missing: ${unclassified.map((r) => r.note_id).join(", ")}`);
      return;
    }
    const incomeWithoutYield = rows.filter(
      (r) => r.note_type === "Income" && (!r.yield_pct || r.yield_pct <= 0)
    );
    if (incomeWithoutYield.length > 0) {
      setError(`Income notes need a yield > 0: ${incomeWithoutYield.map((r) => r.note_id).join(", ")}`);
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.classifyNotes(rows);
      setSaved(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-1">Classify Notes</h2>
        <p className="text-sm text-slate-500 mb-5">
          Assign a type to each detected note. Income notes require an expected annual yield.
        </p>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">
                  Note ID
                </th>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">
                  Expected Yield (%) <span className="text-slate-400 font-normal">— Income only</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.note_id} className={idx % 2 === 0 ? "" : "bg-slate-50"}>
                  <td className="px-4 py-3 border-b border-slate-100 font-mono font-medium">
                    {row.note_id}
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">
                    <select
                      value={row.note_type}
                      onChange={(e) => update(idx, "note_type", e.target.value)}
                      className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36"
                    >
                      <option value="">— select —</option>
                      {NOTE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3 border-b border-slate-100">
                    {row.note_type === "Income" ? (
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={row.yield_pct}
                        onChange={(e) => update(idx, "yield_pct", parseFloat(e.target.value) || 0)}
                        className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="text-slate-400">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {saved && (
          <div className="mt-4 bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
            Classifications saved successfully.
          </div>
        )}

        <div className="flex gap-3 mt-5">
          <button
            onClick={handleSave}
            disabled={loading}
            className="bg-slate-700 hover:bg-slate-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save Classifications & Yields"}
          </button>
          {saved && (
            <button
              onClick={onContinue}
              className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
            >
              Continue →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
