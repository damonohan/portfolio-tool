"use client";

import { useState, useEffect, useCallback } from "react";
import { api, PortfolioCandidate, BaseMetrics, CandidateMetrics } from "@/lib/api";

// ── Note type colours ─────────────────────────────────────────────────────────
const NOTE_COLORS: Record<string, { border: string; badge: string }> = {
  Income:   { border: "border-blue-400",    badge: "bg-blue-100 text-blue-800" },
  Growth:   { border: "border-emerald-400", badge: "bg-emerald-100 text-emerald-800" },
  Digital:  { border: "border-violet-400",  badge: "bg-violet-100 text-violet-800" },
  Absolute: { border: "border-amber-400",   badge: "bg-amber-100 text-amber-800" },
  MLCD:     { border: "border-teal-400",    badge: "bg-teal-100 text-teal-800" },
  PPN:      { border: "border-teal-400",    badge: "bg-teal-100 text-teal-800" },
};
const noteColor = (t: string) =>
  NOTE_COLORS[t] ?? { border: "border-slate-300", badge: "bg-slate-100 text-slate-700" };

// ── Formatters ────────────────────────────────────────────────────────────────
const fmtSharpe = (v: number) => v.toFixed(3);
const fmtPct    = (v: number) => v.toFixed(1) + "%";
const fmtShorty = (v: number) => v.toFixed(3);
const fmtIncome = (v: number) => v.toFixed(2) + "%";
const fmtMean   = (v: number) => (v * 100).toFixed(2) + "%";

// ── Delta cell ────────────────────────────────────────────────────────────────
function DeltaCell({
  value, base, higherBetter, fmt,
}: {
  value: number; base: number; higherBetter: boolean; fmt: (v: number) => string;
}) {
  const delta    = value - base;
  const improved = higherBetter ? delta > 0.0005 : delta < -0.0005;
  const worse    = higherBetter ? delta < -0.0005 : delta > 0.0005;

  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-slate-800 font-medium tabular-nums">{fmt(value)}</span>
      {(improved || worse) && (
        <span className={`text-xs font-semibold tabular-nums ${improved ? "text-emerald-600" : "text-red-500"}`}>
          {improved ? "▲" : "▼"} {fmt(Math.abs(delta))}
        </span>
      )}
    </div>
  );
}

// ── Allocation bar ────────────────────────────────────────────────────────────
function AllocationBar({ pct, max }: { pct: number; max: number }) {
  const w = max > 0 ? Math.round((pct / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-100 rounded-full h-1.5">
        <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${w}%` }} />
      </div>
      <span className="text-xs text-slate-600 tabular-nums w-10 text-right shrink-0">{pct.toFixed(1)}%</span>
    </div>
  );
}

// ── Base row ──────────────────────────────────────────────────────────────────
function BaseRow({ base }: { base: BaseMetrics }) {
  const td = "px-3 py-2.5 text-right tabular-nums font-semibold text-slate-700";
  return (
    <tr className="bg-slate-100 border-b-2 border-slate-300">
      <td className="sticky left-0 bg-slate-100 z-10 pl-4 pr-3 py-2.5 font-bold text-slate-800 whitespace-nowrap text-sm">
        BASE
      </td>
      <td className={`${td} text-slate-400`}>—</td>
      <td className={td}>{fmtSharpe(base.sharpe)}</td>
      <td className={td}>{fmtPct(base.pct_neg)}</td>
      <td className={td}>{fmtShorty(base.shorty)}</td>
      <td className={td}>{fmtIncome(base.expected_income_pct)}</td>
      <td className={td}>{fmtMean(base.mean)}</td>
    </tr>
  );
}

// ── Note group rows ───────────────────────────────────────────────────────────
function NoteGroup({
  note, base,
}: {
  note: { note_id: string; note_type: string; yield_pct: number; candidates: CandidateMetrics[] };
  base: BaseMetrics;
}) {
  const { border, badge } = noteColor(note.note_type);

  return (
    <>
      {note.candidates.map((c, idx) => {
        const isFirst = idx === 0;
        const isLast  = idx === note.candidates.length - 1;
        const rowBg   = idx % 2 === 0 ? "bg-white" : "bg-slate-50/60";
        const borderB = isLast ? "border-b-2 border-slate-200" : "border-b border-slate-100";

        return (
          <tr key={c.alloc_pct} className={`${rowBg} ${borderB}`}>
            <td className={`sticky left-0 z-10 pl-0 pr-3 py-1.5 whitespace-nowrap border-l-4 ${border} ${rowBg}`}>
              {isFirst ? (
                <div className="flex items-center gap-1.5 pl-2">
                  <span className="font-mono text-xs text-slate-700">{note.note_id}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge}`}>{note.note_type}</span>
                  {note.note_type === "Income" && note.yield_pct > 0 && (
                    <span className="text-xs text-slate-500">{note.yield_pct}%</span>
                  )}
                </div>
              ) : null}
            </td>
            <td className="px-3 py-1.5 text-right text-xs text-slate-500 tabular-nums">{c.alloc_pct}%</td>
            <td className="px-3 py-1.5 text-right">
              <DeltaCell value={c.sharpe} base={base.sharpe} higherBetter fmt={fmtSharpe} />
            </td>
            <td className="px-3 py-1.5 text-right">
              <DeltaCell value={c.pct_neg} base={base.pct_neg} higherBetter={false} fmt={fmtPct} />
            </td>
            <td className="px-3 py-1.5 text-right">
              <DeltaCell value={c.shorty} base={base.shorty} higherBetter={false} fmt={fmtShorty} />
            </td>
            <td className="px-3 py-1.5 text-right">
              <DeltaCell value={c.expected_income_pct} base={base.expected_income_pct} higherBetter fmt={fmtIncome} />
            </td>
            <td className="px-3 py-1.5 text-right">
              <DeltaCell value={c.mean} base={base.mean} higherBetter fmt={fmtMean} />
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Portfolio accordion panel ─────────────────────────────────────────────────
function PortfolioPanel({ port, defaultOpen }: { port: PortfolioCandidate; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const { base }        = port;
  const maxWeight       = Math.max(...port.allocations.map((a) => a.weight_pct));

  const thSt = "sticky left-0 bg-slate-50 z-10 text-left pl-4 pr-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 whitespace-nowrap";
  const thR  = "text-right px-3 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide border-b border-slate-200 whitespace-nowrap";

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 bg-slate-50 hover:bg-slate-100 transition-colors border-b border-slate-200"
      >
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-xs">{open ? "▼" : "▶"}</span>
          <span className="font-semibold text-slate-800 text-base">{port.name}</span>
          <span className="text-xs text-slate-500">
            {port.allocations.length} assets · {port.notes.length} notes · {port.notes.length * 8} rows
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded font-medium">
            Sharpe {fmtSharpe(base.sharpe)}
          </span>
          <span className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded font-medium">
            %Neg {fmtPct(base.pct_neg)}
          </span>
          <span className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded font-medium">
            Income {fmtIncome(base.expected_income_pct)}
          </span>
          <span className="bg-white border border-slate-200 text-slate-700 px-2 py-1 rounded font-medium">
            Mean {fmtMean(base.mean)}
          </span>
        </div>
      </button>

      {open && (
        <div className="flex gap-5 p-5">
          {/* Asset allocations */}
          <div className="w-52 shrink-0">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Asset Allocation</p>
            <div className="space-y-2">
              {port.allocations.map((a) => (
                <div key={a.asset}>
                  <span className="text-xs text-slate-600 truncate block" title={a.asset}>{a.asset}</span>
                  <AllocationBar pct={a.weight_pct} max={maxWeight} />
                </div>
              ))}
            </div>
          </div>

          {/* Candidates table */}
          <div className="flex-1 min-w-0 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className={thSt}>Note</th>
                  <th className={thR}>Alloc</th>
                  <th className={thR}>Sharpe</th>
                  <th className={thR}>% Neg</th>
                  <th className={thR}>Shorty</th>
                  <th className={thR}>E. Income</th>
                  <th className={thR}>Mean Ret</th>
                </tr>
              </thead>
              <tbody>
                <BaseRow base={base} />
                {port.notes.map((note) => (
                  <NoteGroup key={note.note_id} note={note} base={base} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props { onContinue: () => void; }

export default function Screen4PortfolioSummary({ onContinue }: Props) {
  const [portfolios, setPortfolios]       = useState<PortfolioCandidate[]>([]);
  const [horizon, setHorizon]             = useState<1 | 2 | 3>(1);
  const [riskFree, setRiskFree]           = useState(2.0);
  const [riskFreeInput, setRiskFreeInput] = useState("2.0");
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");

  const load = useCallback(async (h: number, rf: number) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.portfolioCandidates(h, rf);
      setPortfolios(data.portfolios);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(1, 2.0); }, [load]);

  const handleHorizon = (h: 1 | 2 | 3) => { setHorizon(h); load(h, riskFree); };

  const handleRfBlur = () => {
    const v = parseFloat(riskFreeInput);
    if (!isNaN(v) && v >= 0 && v <= 20) { setRiskFree(v); load(horizon, v); }
    else setRiskFreeInput(riskFree.toString());
  };

  return (
    <div className="space-y-5">
      {/* ── Header card ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm px-6 py-5">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Portfolio Candidates</h2>
            <p className="text-sm text-slate-500 mt-1">
              Each note at allocations 5%–40% (5% steps), blended with the base portfolio
              by proportionally reducing all assets. <span className="text-emerald-600 font-medium">Green ▲</span> = improves vs base ·{" "}
              <span className="text-red-500 font-medium">Red ▼</span> = regresses.
            </p>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {/* Horizon */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600">Horizon</span>
              <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
                {([1, 2, 3] as const).map((h) => (
                  <button
                    key={h}
                    onClick={() => handleHorizon(h)}
                    className={`px-3 py-1.5 font-medium transition-colors ${
                      horizon === h ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {h}yr
                  </button>
                ))}
              </div>
            </div>

            {/* RFR */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-600 whitespace-nowrap">Risk-Free Rate</span>
              <input
                type="number"
                value={riskFreeInput}
                onChange={(e) => setRiskFreeInput(e.target.value)}
                onBlur={handleRfBlur}
                min={0} max={20} step={0.1}
                className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-slate-500">
          <div className="animate-spin w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full mr-3" />
          Calculating all candidate portfolios…
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-5 py-4 text-sm">{error}</div>
      )}

      {/* ── Portfolio panels ── */}
      {!loading && portfolios.map((port, i) => (
        <PortfolioPanel key={port.name} port={port} defaultOpen={i === 0} />
      ))}

      {/* ── Continue ── */}
      {!loading && portfolios.length > 0 && (
        <div className="flex justify-end pt-2">
          <button
            onClick={onContinue}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors shadow-sm"
          >
            Select Framework &amp; Run Analysis →
          </button>
        </div>
      )}
    </div>
  );
}
