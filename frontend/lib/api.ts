const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "Request failed");
  }
  return res.json();
}

export const api = {
  reset: () => req<{ ok: boolean }>("/reset", { method: "POST" }),

  upload: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return req<{
      asset_cols: string[];
      note_ids: string[];
      row_count: number;
      fingerprint: string;
      restored_portfolios: number;
      restored_note_meta: boolean;
      restored_asset_meta: boolean;
      note_suggestions: Record<string, NoteMeta>;
      auto_classified: boolean;
      preview: Record<string, unknown>[];
    }>("/upload", { method: "POST", body: fd });
  },

  listFiles: () =>
    req<{
      fingerprint: string;
      filename: string;
      row_count: number;
      asset_cols: string[];
      note_ids: string[];
      portfolio_count: number;
      portfolio_names: string[];
      updated_at: string;
    }[]>("/files"),

  classifyNotes: (classifications: { note_id: string; note_type: string; yield_pct: number; income_eligible: boolean }[]) =>
    req<{ ok: boolean }>("/classify-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ classifications }),
    }),

  setAssetMetadata: (assets: { asset: string; yield_pct: number; bucket: string }[]) =>
    req<{ ok: boolean }>("/asset-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assets }),
    }),

  savePortfolio: (name: string, weights: Record<string, number>, riskFree = 2.0) =>
    req<{ ok: boolean; portfolios: string[]; risk_free: number }>("/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, weights, risk_free: riskFree }),
    }),

  deletePortfolio: (name: string) =>
    req<{ ok: boolean }>(`/portfolio/${encodeURIComponent(name)}`, { method: "DELETE" }),

  getPortfolios: () =>
    req<{ name: string; asset_count: number; weights: Record<string, number>; risk_free: number }[]>("/portfolios"),

  findImprovements: (params: {
    portfolio_name: string;
    outlook: string;
    risk_tolerance: string;
    goal: string;
    horizon: number;
    ensure_note_id?: string;
  }) =>
    req<{
      base: { sharpe: number; pct_neg: number; shorty: number; downside_kurt: number; expected_income_pct: number };
      improvements: Improvement[];
    }>("/find-improvements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

  getHistogram: (index: number) => req<PlotlyData>(`/histogram/${index}`),

  getImprovementDetail: (index: number) => req<ImprovementDetail>(`/improvement-detail/${index}`),

  sessionState: () =>
    req<{
      has_file: boolean;
      fingerprint: string;
      asset_cols: string[];
      note_ids: string[];
      note_meta: Record<string, NoteMeta>;
      asset_yields: Record<string, number>;
      asset_buckets: Record<string, string>;
      portfolios: string[];
      has_precalc: boolean;
      has_improvements: boolean;
      note_suggestions: Record<string, NoteMeta>;
      has_framework_config: boolean;
    }>("/session-state"),

  portfolioSummary: (horizon = 1, riskFree = 2.0) =>
    req<{
      portfolios: {
        name: string;
        allocations: { asset: string; weight_pct: number }[];
        sharpe: number;
        pct_neg: number;
        shorty: number;
        expected_income_pct: number;
        mean: number;
        std: number;
      }[];
      notes: { note_id: string; note_type: string; yield_pct: number }[];
      horizon: number;
      risk_free: number;
    }>(`/portfolio-summary?horizon=${horizon}&risk_free=${riskFree}`),

  portfolioCandidates: (riskFree = 2.0) =>
    req<{
      portfolios: PortfolioCandidate[];
      risk_free: number;
    }>(`/portfolio-candidates?risk_free=${riskFree}`),

  portfolioPrecalc: () =>
    req<{ portfolios: Record<string, PortfolioPrecalc>; missing?: string[] }>("/portfolio-precalc"),

  triggerPrecalc: (portfolioName: string) =>
    req<{ ok: boolean; portfolio_name: string }>(
      `/precalc/${encodeURIComponent(portfolioName)}`,
      { method: "POST" }
    ),

  getFrameworkConfig: () => req<FrameworkConfig>("/framework-config"),

  saveFrameworkConfig: (config: FrameworkConfig) =>
    req<{ ok: boolean }>("/framework-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    }),

  resetFrameworkConfig: () =>
    req<{ ok: boolean; config: FrameworkConfig }>("/framework-config/reset", { method: "POST" }),

  getEfficientFrontier: (outlook = "Neutral") =>
    req<EfficientFrontierData>(`/efficient-frontier?outlook=${outlook}`),

  exportCsvUrl: () => `${BASE}/export/csv`,
  exportPdfUrl: () => `${BASE}/export/pdf`,
};

// ── Note metadata (extended from Notes sheet) ──────────────────────────────
export interface NoteMeta {
  type: string;
  yield_pct: number;
  income_eligible?: boolean;
  underlier: string;
  protection_type: string;
  protection_pct: number;
  coupon_protection: number | null;
  callability: string;
  solve_for_param: string;
  quote_used: number;
}

// ── Framework config (27-cell grid) ────────────────────────────────────────
export interface CellConfig {
  allowed_types: string[];
  allowed_underlyings: string[];
  allowed_protection_types: string[];
  min_protection_pct: number;
  max_protection_pct: number;
  max_alloc_pct: number;
}

export interface FrameworkConfig {
  outlook_buckets: Record<string, string[]>;
  cells: Record<string, CellConfig>;  // key = "outlook|risk_tolerance|goal"
}

export interface HorizonMetrics {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  downside_kurt: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}

// kept for legacy /portfolio-summary usage
export interface BaseMetrics extends HorizonMetrics {}

export interface CandidateMetrics {
  alloc_pct: number;
  weights: Record<string, number>;  // complete portfolio weights incl note (all %)
  h1: HorizonMetrics;
  h2: HorizonMetrics;
  h3: HorizonMetrics;
}

export interface NoteCandidate {
  note_id: string;
  note_type: string;
  yield_pct: number;
  candidates: CandidateMetrics[];
}

export interface PortfolioCandidate {
  name: string;
  allocations: { asset: string; weight_pct: number }[];
  base: { h1: HorizonMetrics; h2: HorizonMetrics; h3: HorizonMetrics };
  notes: NoteCandidate[];
}

// ── Pre-calc types ─────────────────────────────────────────────────────────────

export interface PrecalcMetrics {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  downside_kurt: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}

export interface PrecalcCandidate {
  note_id: string;
  note_type: string;
  alloc_pct: number;  // fraction, e.g. 0.05
  underlier: string;
  protection_type: string;
  protection_pct: number;
  metrics: {
    sharpe: number;
    pct_neg: number;
    shorty: number;
    downside_kurt: number;
    mean: number;
    std: number;
    income_boost: number;  // fraction units
  };
}

// Keys are string versions of horizon: "1", "2", "3"
export type OutlookData = Record<string, PrecalcCandidate[]>;

export interface PortfolioPrecalc {
  _base: Record<string, PrecalcMetrics>;  // keys "1","2","3"
  Bullish: OutlookData;
  Bearish: OutlookData;
  Neutral: OutlookData;
  risk_free: number;
}

export interface RankedCandidate {
  note_id: string;
  note_type: string;
  alloc_pct: number;   // fraction
  sharpe: number;
  pct_neg: number;
  shorty: number;
  downside_kurt: number;
  mean: number;
  std: number;
  income_boost: number;
  score: number;
}

export interface Improvement {
  note_id: string;
  note_type: string;
  alloc_pct: number;
  new_sharpe: number;
  new_pct_neg: number;
  new_shorty: number;
  new_downside_kurt: number;
  income_boost: number;
  score: number;
}

export interface PlotlyData {
  data: unknown[];
  layout: unknown;
}

export interface ImprovementDetail {
  note_id: string;
  note_type: string;
  underlier: string;
  protection_type: string;
  protection_pct: number;
  alloc_pct: number;
  base_weights: Record<string, number>;
  after_weights: Record<string, number>;
  base_metrics: { mean: number; std: number; sharpe: number; pct_neg: number; shorty: number; downside_kurt: number; expected_income_pct: number };
  after_metrics: { mean: number; std: number; sharpe: number; pct_neg: number; shorty: number; downside_kurt: number; expected_income_pct: number };
  alloc_curve: { alloc_pct: number; mean_return: number }[];
  histogram: PlotlyData;
}

export interface EfficientFrontierPoint {
  portfolio: string;
  mean: number;
  std: number;
}

export interface EfficientFrontierNotePoint extends EfficientFrontierPoint {
  note_id: string;
  note_type: string;
  underlier: string;
  alloc_pct: number;
}

export interface EfficientFrontierData {
  base_points: EfficientFrontierPoint[];
  note_points: EfficientFrontierNotePoint[];
  note_frontier: EfficientFrontierNotePoint[];
}
