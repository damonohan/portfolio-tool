"use client";

import { useState, useEffect } from "react";
import { api, PortfolioPrecalc, FrameworkConfig, NoteMeta } from "@/lib/api";
import StepNav from "@/components/StepNav";
import Screen1Upload from "@/components/Screen1Upload";
import Screen2ClassifyNotes from "@/components/Screen2ClassifyNotes";
import Screen3PortfolioBuilder from "@/components/Screen3PortfolioBuilder";
import Screen4PortfolioSummary from "@/components/Screen4PortfolioSummary";
import Screen4Analysis from "@/components/Screen4Analysis";
import Screen5Improvements from "@/components/Screen5Improvements";
import ScreenFrameworkConfig from "@/components/ScreenFrameworkConfig";

// risk_free removed — now stored per-portfolio on the backend
export type Framework = {
  outlook: string;
  risk_tolerance: string;
  goal: string;
  portfolio_name: string;
  horizon: number;
};

export default function Home() {
  const [step, setStep]         = useState(1);
  const [maxStep, setMaxStep]   = useState(1);

  // Per-file state
  const [assetCols, setAssetCols]         = useState<string[]>([]);
  const [noteIds, setNoteIds]             = useState<string[]>([]);
  const [noteMeta, setNoteMeta]           = useState<Record<string, NoteMeta>>({});
  const [portNames, setPortNames]         = useState<string[]>([]);
  const [noteSuggestions, setNoteSuggestions] = useState<Record<string, NoteMeta>>({});

  // Pre-calc data — loaded after portfolios are saved, passed to Screen 5
  const [precalcData, setPrecalcData]       = useState<Record<string, PortfolioPrecalc>>({});
  const [precalcLoading, setPrecalcLoading] = useState(false);

  // Framework — lifted so it survives back-navigation between steps 4 & 5
  const [framework, setFramework] = useState<Framework>({
    outlook: "",
    risk_tolerance: "",
    goal: "",
    portfolio_name: "",
    horizon: 1,
  });

  // Framework config (27-cell grid) — loaded once from backend
  const [frameworkConfig, setFrameworkConfig] = useState<FrameworkConfig | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);

  // Restore-notification (shown briefly after upload)
  const [restoreMsg, setRestoreMsg] = useState("");

  const loadPrecalc = async () => {
    setPrecalcLoading(true);
    try {
      const data = await api.portfolioPrecalc();
      setPrecalcData(data.portfolios);
    } catch {
      // non-fatal
    } finally {
      setPrecalcLoading(false);
    }
  };

  const loadFrameworkConfig = async () => {
    try {
      const cfg = await api.getFrameworkConfig();
      setFrameworkConfig(cfg);
    } catch {
      // non-fatal
    }
  };

  // Restore session on mount (handles page refresh)
  useEffect(() => {
    loadFrameworkConfig();
    api.sessionState().then((state) => {
      if (!state.has_file) return;
      setAssetCols(state.asset_cols);
      setNoteIds(state.note_ids);

      const notesDone   = Object.keys(state.note_meta).length > 0;
      const bucketsDone = Object.keys(state.asset_buckets).length > 0;
      const portsDone   = state.portfolios.length > 0;

      let targetStep = 2;
      if (portsDone && bucketsDone) {
        targetStep = 4;
        loadPrecalc();
      } else if (notesDone) {
        targetStep = 3;
      }

      if (state.has_precalc) targetStep = 5;

      if (notesDone) setNoteMeta(state.note_meta);
      if (portsDone) setPortNames(state.portfolios);

      setStep(targetStep);
      setMaxStep(targetStep);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const advanceTo = (s: number) => {
    setStep(s);
    setMaxStep((prev) => Math.max(prev, s));
  };

  const handleReset = async () => {
    await api.reset().catch(() => {});
    setStep(1);
    setMaxStep(1);
    setAssetCols([]);
    setNoteIds([]);
    setNoteMeta({});
    setPortNames([]);
    setPrecalcData({});
    setFramework({ outlook: "", risk_tolerance: "", goal: "", portfolio_name: "", horizon: 1 });
    setRestoreMsg("");
  };

  const handleUpload = (data: {
    assetCols: string[];
    noteIds: string[];
    restoredPortfolios: number;
    restoredNoteMeta: boolean;
    restoredAssetMeta: boolean;
    noteSuggestions: Record<string, NoteMeta>;
    autoClassified: boolean;
  }) => {
    setAssetCols(data.assetCols);
    setNoteIds(data.noteIds);
    setNoteSuggestions(data.noteSuggestions ?? {});

    // Figure out which step to jump to based on what was restored / auto-classified
    if (data.restoredPortfolios > 0 && data.restoredAssetMeta) {
      setPortNames([]);
      advanceTo(4);
      api.getPortfolios().then((ps) => setPortNames(ps.map((p) => p.name)));
      api.sessionState().then((s) => { if (s.note_meta) setNoteMeta(s.note_meta); });
      loadPrecalc();
    } else if (data.restoredNoteMeta || data.autoClassified) {
      // note_meta already saved (restored from DB or auto-classified from Tracking sheet)
      api.sessionState().then((s) => { if (s.note_meta) setNoteMeta(s.note_meta); });
      advanceTo(3);
    } else {
      advanceTo(2);
    }

    if (data.restoredPortfolios > 0) {
      setRestoreMsg(`Restored ${data.restoredPortfolios} portfolio${data.restoredPortfolios > 1 ? "s" : ""} from previous session`);
      setTimeout(() => setRestoreMsg(""), 5000);
    }
  };

  const handleClassified = async () => {
    const state = await api.sessionState();
    setNoteMeta(state.note_meta ?? {});
    // Re-load precalc since note classifications changed
    if (portNames.length > 0) {
      loadPrecalc();
    }
    advanceTo(3);
  };

  const handlePortfolioBuilt = async () => {
    const ps = await api.getPortfolios();
    setPortNames(ps.map((p) => p.name));
    // Load precalc data so Screen 5 has it ready
    await loadPrecalc();
    advanceTo(4);
  };

  const handleFrameworkDone = (fw: Framework) => {
    setFramework(fw);
    advanceTo(6);
  };

  const handleConfigSaved = (cfg: FrameworkConfig) => {
    setFrameworkConfig(cfg);
    // Re-load precalc since eligibility rules changed
    if (portNames.length > 0) {
      loadPrecalc();
    }
  };

  // When navigating back to step 5 from step 6, keep maxStep at 6 so user can go forward again
  const handleStepClick = (s: number) => {
    setStep(s);
  };

  return (
    <div className="min-h-screen" style={{ background: "#f0f4f8" }}>
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="text-2xl">📊</div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 leading-tight">
                Portfolio Note Allocation Tool
              </h1>
              <p className="text-xs text-slate-500">Monte Carlo–based improvement analysis</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {restoreMsg && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 text-sm px-4 py-2 rounded-lg">
                <span>✓</span> {restoreMsg}
              </div>
            )}
            {/* Framework config gear button */}
            <button
              onClick={() => setShowConfigModal(true)}
              title="Framework Configuration"
              className="flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:bg-slate-100 text-sm font-medium px-3 py-2 rounded-lg transition-colors"
            >
              <span className="text-base">⚙</span>
              <span className="hidden sm:inline">Framework</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <StepNav
          current={step}
          maxStep={maxStep}
          onStepClick={handleStepClick}
          onReset={handleReset}
        />

        {step === 1 && <Screen1Upload onContinue={handleUpload} />}

        {step === 2 && (
          <Screen2ClassifyNotes
            noteIds={noteIds}
            noteSuggestions={noteSuggestions}
            onContinue={handleClassified}
          />
        )}

        {step === 3 && (
          <Screen3PortfolioBuilder
            assetCols={assetCols}
            noteIds={noteIds}
            noteMeta={noteMeta}
            onContinue={handlePortfolioBuilt}
          />
        )}

        {step === 4 && (
          <Screen4PortfolioSummary onContinue={() => advanceTo(5)} />
        )}

        {step === 5 && (
          <Screen4Analysis
            portfolioNames={portNames}
            initialFramework={framework}
            precalcData={precalcData}
            precalcLoading={precalcLoading}
            frameworkConfig={frameworkConfig}
            onContinue={handleFrameworkDone}
          />
        )}

        {step === 6 && (
          <Screen5Improvements framework={framework} />
        )}
      </main>

      {/* Framework config modal */}
      {showConfigModal && (
        <ScreenFrameworkConfig
          initialConfig={frameworkConfig}
          onClose={() => setShowConfigModal(false)}
          onSaved={handleConfigSaved}
        />
      )}
    </div>
  );
}
