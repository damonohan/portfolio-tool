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
      note_suggestions: Record<string, { type: string; yield_pct: number }>;
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

  classifyNotes: (classifications: { note_id: string; note_type: string; yield_pct: number }[]) =>
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

  savePortfolio: (name: string, weights: Record<string, number>) =>
    req<{ ok: boolean; portfolios: string[] }>("/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, weights }),
    }),

  deletePortfolio: (name: string) =>
    req<{ ok: boolean }>(`/portfolio/${encodeURIComponent(name)}`, { method: "DELETE" }),

  getPortfolios: () =>
    req<{ name: string; asset_count: number; weights: Record<string, number> }[]>("/portfolios"),

  calculateBase: (params: {
    portfolio_name: string;
    horizon: number;
    risk_free: number;
    outlook: string;
    risk_tolerance: string;
    goal: string;
  }) =>
    req<{
      sharpe: number;
      pct_neg: number;
      shorty: number;
      expected_income_pct: number;
      mean: number;
      std: number;
    }>("/calculate-base", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }),

  findImprovements: () =>
    req<{
      base: { sharpe: number; pct_neg: number; shorty: number; expected_income_pct: number };
      improvements: Improvement[];
    }>("/find-improvements", { method: "POST" }),

  getHistogram: (index: number) => req<PlotlyData>(`/histogram/${index}`),

  sessionState: () =>
    req<{
      has_file: boolean;
      fingerprint: string;
      asset_cols: string[];
      note_ids: string[];
      note_meta: Record<string, { type: string; yield_pct: number }>;
      asset_yields: Record<string, number>;
      asset_buckets: Record<string, string>;
      portfolios: string[];
      has_base: boolean;
      has_improvements: boolean;
      note_suggestions: Record<string, { type: string; yield_pct: number }>;
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

  portfolioCandidates: (horizon = 1, riskFree = 2.0) =>
    req<{
      portfolios: PortfolioCandidate[];
      horizon: number;
      risk_free: number;
    }>(`/portfolio-candidates?horizon=${horizon}&risk_free=${riskFree}`),

  exportCsvUrl: () => `${BASE}/export/csv`,
  exportPdfUrl: () => `${BASE}/export/pdf`,
};

export interface CandidateMetrics {
  alloc_pct: number;
  sharpe: number;
  pct_neg: number;
  shorty: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}

export interface NoteCandidate {
  note_id: string;
  note_type: string;
  yield_pct: number;
  candidates: CandidateMetrics[];
}

export interface BaseMetrics {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}

export interface PortfolioCandidate {
  name: string;
  allocations: { asset: string; weight_pct: number }[];
  base: BaseMetrics;
  notes: NoteCandidate[];
}

export interface Improvement {
  note_id: string;
  note_type: string;
  alloc_pct: number;
  new_sharpe: number;
  new_pct_neg: number;
  new_shorty: number;
  income_boost: number;
  score: number;
}

export interface PlotlyData {
  data: unknown[];
  layout: unknown;
}
