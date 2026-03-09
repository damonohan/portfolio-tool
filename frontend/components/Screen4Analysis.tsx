"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";

const OUTLOOKS      = ["Bearish", "Neutral", "Bullish"] as const;
const RISK_LEVELS   = ["Conservative", "Moderate", "Aggressive"] as const;
const GOALS         = ["Growth", "Balanced", "Income"] as const;
const HORIZONS      = [1, 2, 3] as const;

interface BaseResult {
  sharpe: number;
  pct_neg: number;
  shorty: number;
  expected_income_pct: number;
  mean: number;
  std: number;
}

import type { Framework } from "@/app/page";

interface Props {
  portfolioNames: string[];
  initialFramework: Framework;
  onContinue: (framework: Framework) => void;
}

export default function Screen4Analysis({ portfolioNames, initialFramework, onContinue }: Props) {
  const [outlook,     setOutlook]     = useState<string>(initialFramework.outlook);
  const [risk,        setRisk]        = useState<string>(initialFramework.risk_tolerance);
  const [goal,        setGoal]        = useState<string>(initialFramework.goal);
  const [horizon,     setHorizon]     = useState<number>(initialFramework.horizon || 1);
  const [riskFree,    setRiskFree]    = useState<number>(initialFramework.risk_free || 2.0);
  const [portName,    setPortName]    = useState<string>(
    initialFramework.portfolio_name || portfolioNames[0] || ""
  );
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState("");
  const [result,      setResult]      = useState<BaseResult | null>(null);

  useEffect(() => {
    if (portfolioNames.length > 0 && !portName) setPortName(portfolioNames[0]);
  }, [portfolioNames, portName]);

  const calculate = async () => {
    if (!outlook || !risk || !goal || !portName) {
      setError("Please complete all selections.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await api.calculateBase({
        portfolio_name:  portName,
        horizon,
        risk_free:       riskFree,
        outlook,
        risk_tolerance:  risk,
        goal,
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Calculation failed");
    } finally {
      setLoading(false);
    }
  };

  const RadioGroup = ({
    label, options, value, onChange,
  }: { label: string; options: readonly string[]; value: string; onChange: (v: string) => void }) => (
    <div>
      <p className="text-sm font-semibold text-slate-600 mb-2">{label}</p>
      <div className="flex gap-2 flex-wrap">
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              value === o
                ? "bg-blue-700 text-white border-blue-700"
                : "bg-white text-slate-700 border-slate-300 hover:border-blue-400"
            }`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );

  const MetricCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 text-center">
      <div className="text-2xl font-bold text-blue-700">{value}</div>
      <div className="text-xs font-semibold text-slate-500 mt-1 uppercase tracking-wide">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5">
        <div>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Framework & Base Analysis</h2>
          <p className="text-sm text-slate-500">Set your investment framework and calculate base portfolio metrics.</p>
        </div>

        <RadioGroup label="Market Outlook" options={OUTLOOKS} value={outlook} onChange={setOutlook} />
        <RadioGroup label="Risk Tolerance" options={RISK_LEVELS} value={risk} onChange={setRisk} />
        <RadioGroup label="Portfolio Goal" options={GOALS} value={goal} onChange={setGoal} />

        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Simulation Horizon</p>
            <select
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {HORIZONS.map((h) => (
                <option key={h} value={h}>{h} {h === 1 ? "Year" : "Years"}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Risk-Free Rate (%)</p>
            <input
              type="number"
              min={0}
              step={0.1}
              value={riskFree}
              onChange={(e) => setRiskFree(parseFloat(e.target.value) || 0)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-600 mb-2">Starting Portfolio</p>
            <select
              value={portName}
              onChange={(e) => setPortName(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {portfolioNames.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
        )}

        <button
          onClick={calculate}
          disabled={loading}
          className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors disabled:opacity-50"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full inline-block" />
              Calculating…
            </span>
          ) : "Calculate Base Portfolio"}
        </button>
      </div>

      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-4">
          <h3 className="text-lg font-bold text-slate-800">Base Portfolio Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricCard label="Sharpe Ratio" value={result.sharpe.toFixed(4)} />
            <MetricCard label="% Negative" value={`${result.pct_neg.toFixed(2)}%`} sub="Simulations below 0%" />
            <MetricCard label="Shorty" value={result.shorty.toFixed(4)} sub="Excess kurtosis" />
            <MetricCard label="Expected Income" value={`${result.expected_income_pct.toFixed(2)}%`} />
          </div>
          <div className="flex gap-4 text-sm text-slate-500 pt-1">
            <span>Mean return: <strong className="text-slate-800">{(result.mean * 100).toFixed(2)}%</strong></span>
            <span>Std dev: <strong className="text-slate-800">{(result.std * 100).toFixed(2)}%</strong></span>
          </div>

          <button
            onClick={() =>
              onContinue({ outlook, risk_tolerance: risk, goal, portfolio_name: portName, horizon, risk_free: riskFree })
            }
            className="bg-blue-700 hover:bg-blue-800 text-white font-semibold py-2.5 px-6 rounded-lg transition-colors"
          >
            Find Improvements →
          </button>
        </div>
      )}
    </div>
  );
}
