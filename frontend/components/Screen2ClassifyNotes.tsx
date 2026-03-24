"use client";

import { useState, useEffect } from "react";
import { api, NoteMeta } from "@/lib/api";

const NOTE_TYPES = ["Income", "Growth", "Digital", "Absolute", "MLCD", "PPN", "Snowball"] as const;

interface NoteRow {
  note_id:       string;
  note_type:     string;
  yield_pct:     number;
  auto_detected: boolean; // came from Tracking/Notes sheet, not yet manually changed
}

interface Props {
  noteIds:          string[];
  noteSuggestions:  Record<string, NoteMeta>;
  onContinue:       () => void;
}

export default function Screen2ClassifyNotes({ noteIds, noteSuggestions, onContinue }: Props) {
  const [rows, setRows] = useState<NoteRow[]>(
    noteIds.map((id) => {
      const s = noteSuggestions[id];
      return {
        note_id:       id,
        note_type:     s?.type     ?? "",
        yield_pct:     s?.yield_pct ?? 0,
        auto_detected: !!(s?.type),
      };
    })
  );

  // Extended metadata from the Notes sheet — read-only display columns
  const [extendedMeta, setExtendedMeta] = useState<Record<string, NoteMeta>>({});

  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");
  const [saved,   setSaved]   = useState(false);

  // Pre-populate from saved session state when navigating back
  useEffect(() => {
    api.sessionState().then((state) => {
      const meta        = state.note_meta        ?? {};
      const suggestions = state.note_suggestions ?? {};

      // Store extended metadata for display (suggestions have the full Notes-sheet data)
      const extended: Record<string, NoteMeta> = {};
      for (const [id, m] of Object.entries(suggestions)) {
        extended[id] = m as NoteMeta;
      }
      // Also fill from confirmed meta if suggestions not available
      for (const [id, m] of Object.entries(meta)) {
        if (!extended[id]) extended[id] = m as NoteMeta;
      }
      setExtendedMeta(extended);

      if (Object.keys(meta).length > 0) {
        // Previously confirmed classifications take priority
        setRows(noteIds.map((id) => ({
          note_id:       id,
          note_type:     meta[id]?.type      ?? "",
          yield_pct:     meta[id]?.yield_pct ?? 0,
          auto_detected: false,
        })));
        setSaved(true);
      } else if (Object.keys(suggestions).length > 0) {
        // Auto-suggestions from Tracking sheet (not yet saved by user)
        setRows(noteIds.map((id) => {
          const s = suggestions[id];
          return {
            note_id:       id,
            note_type:     s?.type      ?? "",
            yield_pct:     s?.yield_pct ?? 0,
            auto_detected: !!(s?.type),
          };
        }));
      }
    }).catch(() => {});
  }, [noteIds]);

  const update = (idx: number, field: keyof NoteRow, value: string | number) => {
    setSaved(false);
    setRows((prev) =>
      prev.map((r, i) =>
        i === idx ? { ...r, [field]: value, auto_detected: false } : r
      )
    );
  };

  // Check whether any note has extended metadata to show those columns
  const hasUnderlier      = noteIds.some((id) => extendedMeta[id]?.underlier);
  const hasProtectionType = noteIds.some((id) => extendedMeta[id]?.protection_type);
  const hasProtectionPct  = noteIds.some((id) => (extendedMeta[id]?.protection_pct ?? 0) > 0);
  const hasCallability    = noteIds.some((id) => extendedMeta[id]?.callability);
  const showExtended      = hasUnderlier || hasProtectionType || hasProtectionPct || hasCallability;

  const autoCount = rows.filter((r) => r.auto_detected && r.note_type).length;

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
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
        <h2 className="text-xl font-bold text-slate-800 mb-1">Classify Notes</h2>
        <p className="text-sm text-slate-500 mb-4">
          Assign a type to each detected note. Income notes require an expected annual yield.
          {showExtended && " Extended metadata from the Notes sheet is shown for reference (read-only)."}
        </p>

        {autoCount > 0 && (
          <div className="mb-4 flex items-start gap-2 bg-blue-50 border border-blue-200 text-blue-800 text-sm px-4 py-3 rounded-lg">
            <span className="text-base">✦</span>
            <span>
              <strong>{autoCount} of {rows.length} notes</strong> were auto-classified from the
              Tracking sheet. Review and adjust as needed before saving.
            </span>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                  Note ID
                </th>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500">
                  Type
                </th>
                <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                  Expected Yield (%) <span className="text-slate-400 font-normal">— Income only</span>
                </th>
                {/* Extended metadata columns — shown only when Notes sheet data is present */}
                {hasUnderlier && (
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                    Underlier
                  </th>
                )}
                {hasProtectionType && (
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                    Protection Type
                  </th>
                )}
                {hasProtectionPct && (
                  <th className="px-4 py-3 text-right font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                    Prot %
                  </th>
                )}
                {hasCallability && (
                  <th className="px-4 py-3 text-left font-semibold bg-slate-50 border-b border-slate-200 text-slate-500 whitespace-nowrap">
                    Callability
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const ext = extendedMeta[row.note_id];
                return (
                  <tr key={row.note_id} className={idx % 2 === 0 ? "" : "bg-slate-50"}>
                    <td className="px-4 py-3 border-b border-slate-100 font-mono font-medium whitespace-nowrap">
                      {row.note_id}
                      {row.auto_detected && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-sans font-medium">
                          auto
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100">
                      <select
                        value={row.note_type}
                        onChange={(e) => update(idx, "note_type", e.target.value)}
                        className={`border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-36 ${
                          row.auto_detected
                            ? "border-blue-300 bg-blue-50"
                            : "border-slate-300"
                        }`}
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
                          step={0.01}
                          value={row.yield_pct}
                          onChange={(e) => update(idx, "yield_pct", parseFloat(e.target.value) || 0)}
                          className={`border rounded-lg px-2 py-1.5 text-sm w-24 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            row.auto_detected
                              ? "border-blue-300 bg-blue-50"
                              : "border-slate-300"
                          }`}
                        />
                      ) : (
                        <span className="text-slate-400">N/A</span>
                      )}
                    </td>
                    {/* Extended metadata cells (read-only) */}
                    {hasUnderlier && (
                      <td className="px-4 py-3 border-b border-slate-100 text-slate-600 whitespace-nowrap">
                        {ext?.underlier || <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasProtectionType && (
                      <td className="px-4 py-3 border-b border-slate-100 text-slate-600">
                        {ext?.protection_type || <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasProtectionPct && (
                      <td className="px-4 py-3 border-b border-slate-100 text-right text-slate-600">
                        {(ext?.protection_pct ?? 0) > 0
                          ? `${ext!.protection_pct}%`
                          : <span className="text-slate-300">—</span>}
                      </td>
                    )}
                    {hasCallability && (
                      <td className="px-4 py-3 border-b border-slate-100 text-slate-600 whitespace-nowrap">
                        {ext?.callability || <span className="text-slate-300">—</span>}
                      </td>
                    )}
                  </tr>
                );
              })}
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
