"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { api, PortfolioPrecalc, PrecalcMetrics, RankedCandidate, FrameworkConfig, NoteMeta } from "@/lib/api";
import { computeRankedCandidates } from "@/lib/ranking";

export type Framework = {
  outlook: string;
  risk_tolerance: string;
  goal: string;
  portfolio_name: string;
  horizon: number;
};

interface AppState {
  // Session data
  assetCols: string[];
  noteIds: string[];
  noteMeta: Record<string, NoteMeta>;
  noteSuggestions: Record<string, NoteMeta>;
  portfolioNames: string[];

  // Precalc
  precalcData: Record<string, PortfolioPrecalc>;
  precalcLoading: boolean;
  precalcStatus: string;

  // Framework
  framework: Framework;
  setFramework: (f: Framework) => void;
  frameworkConfig: FrameworkConfig | null;

  // Allocation range
  minAlloc: number;
  maxAlloc: number;
  setMinAlloc: (v: number) => void;
  setMaxAlloc: (v: number) => void;

  // Computed
  baseMetrics: PrecalcMetrics | null;
  ranked: RankedCandidate[];

  // Admin
  adminAuthenticated: boolean;
  setAdminAuthenticated: (v: boolean) => void;

  // Actions
  loadPrecalc: () => Promise<void>;
  setAssetCols: (v: string[]) => void;
  setNoteIds: (v: string[]) => void;
  setNoteMeta: (v: Record<string, NoteMeta>) => void;
  setNoteSuggestions: (v: Record<string, NoteMeta>) => void;
  setPortfolioNames: (v: string[]) => void;
  setFrameworkConfig: (v: FrameworkConfig | null) => void;
  resetSession: () => Promise<void>;

  // Improvements state (for histogram screens)
  improvementsComputed: boolean;
  setImprovementsComputed: (v: boolean) => void;

  // Session loaded flag
  sessionLoaded: boolean;
}

const AppContext = createContext<AppState | null>(null);

export function useAppContext() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used within AppProvider");
  return ctx;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [assetCols, setAssetCols] = useState<string[]>([]);
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [noteMeta, setNoteMeta] = useState<Record<string, NoteMeta>>({});
  const [noteSuggestions, setNoteSuggestions] = useState<Record<string, NoteMeta>>({});
  const [portfolioNames, setPortfolioNames] = useState<string[]>([]);

  const [precalcData, setPrecalcData] = useState<Record<string, PortfolioPrecalc>>({});
  const [precalcLoading, setPrecalcLoading] = useState(false);
  const [precalcStatus, setPrecalcStatus] = useState("");

  const [framework, setFramework] = useState<Framework>({
    outlook: "Neutral",
    risk_tolerance: "Moderate",
    goal: "Balanced",
    portfolio_name: "",
    horizon: 1,
  });

  const [frameworkConfig, setFrameworkConfig] = useState<FrameworkConfig | null>(null);
  const [minAlloc, setMinAlloc] = useState(5);
  const [maxAlloc, setMaxAlloc] = useState(30);

  const [adminAuthenticated, setAdminAuthenticatedRaw] = useState(false);
  const [improvementsComputed, setImprovementsComputed] = useState(false);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  const setAdminAuthenticated = useCallback((v: boolean) => {
    setAdminAuthenticatedRaw(v);
    if (typeof window !== "undefined") {
      if (v) sessionStorage.setItem("adminAuth", "1");
      else sessionStorage.removeItem("adminAuth");
    }
  }, []);

  const loadPrecalc = useCallback(async () => {
    setPrecalcLoading(true);
    setPrecalcStatus("");
    try {
      const data = await api.portfolioPrecalc();
      setPrecalcData(data.portfolios);
      if (data.missing && data.missing.length > 0) {
        for (let i = 0; i < data.missing.length; i++) {
          const name = data.missing[i];
          setPrecalcStatus(`Computing "${name}" (${i + 1}/${data.missing.length})...`);
          try { await api.triggerPrecalc(name); } catch { /* non-fatal */ }
        }
        const updated = await api.portfolioPrecalc();
        setPrecalcData(updated.portfolios);
      }
    } catch { /* non-fatal */ }
    finally {
      setPrecalcLoading(false);
      setPrecalcStatus("");
    }
  }, []);

  const resetSession = useCallback(async () => {
    await api.reset().catch(() => {});
    setAssetCols([]);
    setNoteIds([]);
    setNoteMeta({});
    setPortfolioNames([]);
    setPrecalcData({});
    setFramework({ outlook: "Neutral", risk_tolerance: "Moderate", goal: "Balanced", portfolio_name: "", horizon: 1 });
    setImprovementsComputed(false);
  }, []);

  // Hydrate on mount
  useEffect(() => {
    // Restore admin auth from sessionStorage
    if (typeof window !== "undefined" && sessionStorage.getItem("adminAuth") === "1") {
      setAdminAuthenticatedRaw(true);
    }

    // Load framework config
    api.getFrameworkConfig().then(setFrameworkConfig).catch(() => {});

    // Restore session state
    api.sessionState().then((state) => {
      if (!state.has_file) {
        setSessionLoaded(true);
        return;
      }
      setAssetCols(state.asset_cols);
      setNoteIds(state.note_ids);
      if (Object.keys(state.note_meta).length > 0) setNoteMeta(state.note_meta);
      if (state.portfolios.length > 0) setPortfolioNames(state.portfolios);

      const portsDone = state.portfolios.length > 0;
      const bucketsDone = Object.keys(state.asset_buckets).length > 0;

      if (portsDone && bucketsDone) {
        loadPrecalc().then(() => {
          // Auto-select first portfolio if none selected
          if (state.portfolios.length > 0) {
            setFramework(prev => ({
              ...prev,
              portfolio_name: prev.portfolio_name || state.portfolios[0],
            }));
          }
          setSessionLoaded(true);
        });
      } else {
        setSessionLoaded(true);
      }
    }).catch(() => { setSessionLoaded(true); });
  }, [loadPrecalc]);

  // Auto-select first portfolio when portfolioNames change
  useEffect(() => {
    if (portfolioNames.length > 0 && !framework.portfolio_name) {
      setFramework(prev => ({ ...prev, portfolio_name: portfolioNames[0] }));
    }
  }, [portfolioNames, framework.portfolio_name]);

  // Computed ranked candidates
  const { baseMetrics, ranked } = useMemo(() => {
    return computeRankedCandidates({
      portName: framework.portfolio_name,
      outlook: framework.outlook,
      risk: framework.risk_tolerance,
      goal: framework.goal,
      horizon: framework.horizon,
      minAlloc,
      maxAlloc,
      precalcData,
      frameworkConfig,
    });
  }, [framework, minAlloc, maxAlloc, precalcData, frameworkConfig]);

  const value: AppState = {
    assetCols, noteIds, noteMeta, noteSuggestions, portfolioNames,
    precalcData, precalcLoading, precalcStatus,
    framework, setFramework, frameworkConfig,
    minAlloc, maxAlloc, setMinAlloc, setMaxAlloc,
    baseMetrics, ranked,
    adminAuthenticated, setAdminAuthenticated,
    loadPrecalc,
    setAssetCols, setNoteIds, setNoteMeta, setNoteSuggestions,
    setPortfolioNames, setFrameworkConfig, resetSession,
    improvementsComputed, setImprovementsComputed,
    sessionLoaded,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
