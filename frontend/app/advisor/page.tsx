"use client";

import React, { useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppContext } from "@/lib/AppContext";
import { computeRankedCandidates } from "@/lib/ranking";
import { api, NarrativeOption, PrecalcMetrics } from "@/lib/api";
import { AdvisorAnswers } from "@/lib/advisorMapping";
import Link from "next/link";

// ── Wizard step definitions ──────────────────────────────────────────────────

type StepKey = "goal" | "outlook" | "riskTolerance" | "horizon" | "clientInfo";

interface WizardOption {
  label: string;
  value: string;
  description: string;
}

const STEPS: {
  key: StepKey;
  question: string;
  options?: WizardOption[];
  isFreeText?: boolean;
}[] = [
  {
    key: "goal",
    question: "What is this portfolio built for?",
    options: [
      { label: "Growing wealth over time", value: "Growth", description: "Long-term capital appreciation" },
      { label: "Generating income now", value: "Income", description: "Regular cash flow from investments" },
      { label: "A balance of both", value: "Balanced", description: "Growth with income component" },
    ],
  },
  {
    key: "outlook",
    question: "What's the market outlook for this client's horizon?",
    options: [
      { label: "I expect markets to perform well", value: "Bullish", description: "Positive economic outlook" },
      { label: "I'm uncertain / expecting sideways", value: "Neutral", description: "Mixed signals or range-bound" },
      { label: "I'm concerned about a downturn", value: "Bearish", description: "Defensive positioning warranted" },
    ],
  },
  {
    key: "riskTolerance",
    question: "How would this client react to a bad year?",
    options: [
      { label: "They'd be upset but could stay the course", value: "Aggressive", description: "High tolerance for volatility" },
      { label: "They'd be uncomfortable, might want changes", value: "Moderate", description: "Moderate tolerance" },
      { label: "It would seriously affect their plans or sleep", value: "Conservative", description: "Low tolerance for drawdowns" },
    ],
  },
  {
    key: "horizon",
    question: "What's the investment horizon?",
    options: [
      { label: "About 1 year", value: "1", description: "Short-term" },
      { label: "2-3 years", value: "2", description: "Medium-term" },
      { label: "3+ years", value: "3", description: "Longer-term" },
    ],
  },
  {
    key: "clientInfo",
    question: "Tell us about the client (optional)",
    isFreeText: true,
  },
];

// ── Main Component ───────────────────────────────────────────────────────────

export default function AdvisorPage() {
  const {
    precalcData,
    frameworkConfig,
    portfolioNames,
    loadPrecalc,
    sessionLoaded,
    setFramework,
  } = useAppContext();

  const router = useRouter();

  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [clientDescription, setClientDescription] = useState("");
  const [clientConcern, setClientConcern] = useState("");
  const [narratives, setNarratives] = useState<NarrativeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Select first available portfolio
  const portfolioName = portfolioNames[0] ?? "";
  const hasPrecalc = !!precalcData[portfolioName];

  // Handle option selection for wizard steps
  const handleSelect = useCallback(
    (stepKey: StepKey, value: string) => {
      setAnswers((prev) => ({ ...prev, [stepKey]: value }));
      if (currentStep < STEPS.length - 1) {
        setCurrentStep((s) => s + 1);
      }
    },
    [currentStep]
  );

  // Go back a step
  const handleBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep((s) => s - 1);
  }, [currentStep]);

  // Reset wizard
  const handleReset = useCallback(() => {
    setCurrentStep(0);
    setAnswers({});
    setClientDescription("");
    setClientConcern("");
    setNarratives([]);
    setShowResults(false);
    setError(null);
    setLoading(false);
  }, []);

  // Compute ranked candidates from precalc data
  const topCandidates = useMemo(() => {
    if (!answers.goal || !answers.outlook || !answers.riskTolerance || !answers.horizon) return [];
    const horizon = parseInt(String(answers.horizon), 10);
    // Read max allocation from framework config to match backend filtering
    const cellKey = `${answers.outlook}|${answers.riskTolerance}|${answers.goal}`;
    const cellMaxAlloc = frameworkConfig?.cells?.[cellKey]?.max_alloc_pct ?? 30;
    const { ranked } = computeRankedCandidates({
      portName: portfolioName,
      outlook: answers.outlook,
      risk: answers.riskTolerance,
      goal: answers.goal,
      horizon,
      minAlloc: 5,
      maxAlloc: cellMaxAlloc,
      precalcData,
      frameworkConfig,
    });
    return ranked.slice(0, 3); // Top 3 only
  }, [answers, portfolioName, precalcData, frameworkConfig]);

  // Get base metrics for display
  const baseMetrics: PrecalcMetrics | null = useMemo(() => {
    if (!answers.horizon || !portfolioName || !precalcData[portfolioName]) return null;
    return precalcData[portfolioName]?._base?.[answers.horizon] ?? null;
  }, [answers.horizon, portfolioName, precalcData]);

  // Navigate to histogram detail for the exact candidate
  const exploreOption = useCallback((narrative: NarrativeOption) => {
    setFramework({
      outlook: answers.outlook || "Neutral",
      risk_tolerance: answers.riskTolerance || "Moderate",
      goal: answers.goal || "Balanced",
      portfolio_name: portfolioName,
      horizon: parseInt(String(answers.horizon), 10) || 1,
    });
    router.push(`/histogram/0?note_id=${encodeURIComponent(narrative.note_id)}`);
  }, [answers, portfolioName, setFramework, router]);

  // Submit and generate narratives
  const handleSubmit = useCallback(async () => {
    if (topCandidates.length === 0) {
      setError("No candidates match the selected criteria. Try different settings.");
      return;
    }

    setLoading(true);
    setError(null);

    const horizon = parseInt(String(answers.horizon), 10);

    try {
      // Get full candidate data from precalc for the top candidates
      const outlook = answers.outlook!;
      const precalcCandidates =
        precalcData[portfolioName]?.[outlook as "Bullish" | "Neutral" | "Bearish"]?.[String(horizon)] ?? [];

      const candidatePayload = topCandidates.map((rc) => {
        // Find matching precalc candidate to get alloc_pct as fraction
        const match = precalcCandidates.find(
          (pc) => pc.note_id === rc.note_id && Math.abs(pc.alloc_pct - rc.alloc_pct) < 0.01
        );
        return {
          note_id: rc.note_id,
          alloc_pct: match?.alloc_pct ?? rc.alloc_pct,
        };
      });

      const result = await api.generateNarratives({
        portfolio_name: portfolioName,
        candidates: candidatePayload,
        horizon,
        outlook: answers.outlook!,
        advisor_context: {
          client_concern: clientConcern || "general market risk",
          goal: answers.goal!,
          outlook: answers.outlook!,
          client_description: clientDescription || "No additional context provided.",
        },
      });

      setNarratives(result.narratives);
      setShowResults(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate narratives");
    } finally {
      setLoading(false);
    }
  }, [topCandidates, answers, portfolioName, precalcData, clientDescription, clientConcern]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!sessionLoaded) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center", color: "var(--text-secondary)" }}>
        Loading session data...
      </div>
    );
  }

  if (!portfolioName) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center" }}>
        <h2 style={{ color: "var(--text-primary)", marginBottom: "12px" }}>No Portfolio Available</h2>
        <p style={{ color: "var(--text-secondary)" }}>
          Please upload a simulation file and create a portfolio in the{" "}
          <Link href="/admin/upload" style={{ color: "var(--halo-cyan)" }}>Admin</Link> section first.
        </p>
      </div>
    );
  }

  if (!hasPrecalc) {
    return (
      <div style={{ padding: "60px 24px", textAlign: "center" }}>
        <h2 style={{ color: "var(--text-primary)", marginBottom: "12px" }}>Computing Portfolio Data...</h2>
        <p style={{ color: "var(--text-secondary)", marginBottom: "16px" }}>
          Pre-calculation is needed before the advisor tool can run.
        </p>
        <button
          onClick={loadPrecalc}
          style={{
            padding: "10px 24px",
            background: "var(--halo-cyan)",
            color: "#000",
            border: "none",
            borderRadius: "8px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Start Pre-calculation
        </button>
      </div>
    );
  }

  // ── Results Panel ──────────────────────────────────────────────────────────
  if (showResults) {
    return (
      <div style={{ padding: "32px 24px", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              Portfolio Enhancement Options
            </h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "4px" }}>
              {answers.outlook} outlook · {answers.riskTolerance} risk · {answers.goal} goal · {answers.horizon}-year horizon
            </p>
          </div>
          <button
            onClick={handleReset}
            style={{
              padding: "8px 16px",
              background: "transparent",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
            }}
          >
            Start Over
          </button>
        </div>

        {narratives.length === 0 && (
          <div style={{
            padding: "24px",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            textAlign: "center",
            color: "var(--text-secondary)",
          }}>
            No candidates matched the criteria. Try adjusting your selections.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(narratives.length, 3)}, 1fr)`, gap: "16px" }}>
          {narratives.map((n) => (
            <NarrativeCard key={n.option} narrative={n} baseMetrics={baseMetrics} horizon={parseInt(String(answers.horizon), 10)} onExplore={() => exploreOption(n)} />
          ))}
        </div>

        <div style={{ marginTop: "24px", textAlign: "center" }}>
          <button
            onClick={() => {
              setFramework({
                outlook: answers.outlook || "Neutral",
                risk_tolerance: answers.riskTolerance || "Moderate",
                goal: answers.goal || "Balanced",
                portfolio_name: portfolioName,
                horizon: parseInt(String(answers.horizon), 10) || 1,
              });
              router.push("/analysis");
            }}
            style={{
              color: "var(--halo-cyan)",
              fontSize: "14px",
              textDecoration: "none",
              background: "transparent",
              border: "none",
              cursor: "pointer",
            }}
          >
            See full analysis →
          </button>
        </div>

        <p style={{
          marginTop: "32px",
          fontSize: "11px",
          color: "var(--text-muted)",
          textAlign: "center",
          lineHeight: 1.5,
        }}>
          Results are based on hypothetical Monte Carlo simulation across 10,000 market scenarios
          and do not guarantee future investment outcomes. All performance figures shown are hypothetical.
        </p>
      </div>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  const step = STEPS[currentStep];

  return (
    <div style={{ padding: "40px 24px", maxWidth: "680px", margin: "0 auto" }}>
      {/* Progress dots */}
      <div style={{ display: "flex", gap: "8px", justifyContent: "center", marginBottom: "32px" }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: i < currentStep ? "var(--halo-cyan)" : i === currentStep ? "var(--halo-cyan)" : "var(--border)",
              opacity: i <= currentStep ? 1 : 0.4,
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* Step counter */}
      <div style={{ textAlign: "center", marginBottom: "8px" }}>
        <span style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "1px" }}>
          Step {currentStep + 1} of {STEPS.length}
        </span>
      </div>

      {/* Question */}
      <h2 style={{
        textAlign: "center",
        fontSize: "22px",
        fontWeight: 600,
        color: "var(--text-primary)",
        marginBottom: "32px",
        lineHeight: 1.3,
      }}>
        {step.question}
      </h2>

      {/* Options or free text */}
      {step.isFreeText ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
              Describe the client in a sentence
            </label>
            <input
              type="text"
              value={clientDescription}
              onChange={(e) => setClientDescription(e.target.value)}
              placeholder="e.g., 58 years old, 7 years from retirement, $800k portfolio"
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: "13px", color: "var(--text-secondary)", display: "block", marginBottom: "6px" }}>
              What are they most worried about?
            </label>
            <input
              type="text"
              value={clientConcern}
              onChange={(e) => setClientConcern(e.target.value)}
              placeholder="e.g., worried about a market crash before retirement"
              style={{
                width: "100%",
                padding: "12px 16px",
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: "8px",
                color: "var(--text-primary)",
                fontSize: "14px",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center", marginTop: "16px" }}>
            <button
              onClick={handleBack}
              style={{
                padding: "10px 24px",
                background: "transparent",
                border: "1px solid var(--border)",
                color: "var(--text-secondary)",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "14px",
              }}
            >
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                padding: "10px 32px",
                background: loading ? "var(--border)" : "var(--halo-cyan)",
                color: loading ? "var(--text-muted)" : "#000",
                border: "none",
                borderRadius: "8px",
                fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                fontSize: "14px",
                transition: "all 0.2s",
              }}
            >
              {loading ? "Generating..." : "Generate Options"}
            </button>
          </div>

          {loading && (
            <div style={{ textAlign: "center", marginTop: "16px" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                Generating narratives for your top 3 options... This may take 10-15 seconds.
              </p>
              <div style={{
                display: "flex",
                gap: "8px",
                justifyContent: "center",
                marginTop: "12px",
              }}>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: "var(--halo-cyan)",
                      animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
              <style>{`
                @keyframes pulse {
                  0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
                  40% { opacity: 1; transform: scale(1.2); }
                }
              `}</style>
            </div>
          )}

          {error && (
            <p style={{ color: "#ef4444", fontSize: "13px", textAlign: "center", marginTop: "8px" }}>
              {error}
            </p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {step.options?.map((opt) => {
            const isSelected = answers[step.key] === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => handleSelect(step.key, opt.value)}
                style={{
                  padding: "16px 20px",
                  background: isSelected ? "rgba(0, 212, 255, 0.08)" : "var(--bg-card)",
                  border: isSelected ? "2px solid var(--halo-cyan)" : "1px solid var(--border)",
                  borderRadius: "12px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--text-primary)", marginBottom: "4px" }}>
                  {opt.label}
                </div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                  {opt.description}
                </div>
              </button>
            );
          })}

          {currentStep > 0 && (
            <button
              onClick={handleBack}
              style={{
                marginTop: "8px",
                padding: "8px",
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              ← Back
            </button>
          )}
        </div>
      )}
    </div>
  );
}


// ── Narrative Card Component ─────────────────────────────────────────────────

function NarrativeCard({
  narrative,
  baseMetrics,
  horizon,
  onExplore,
}: {
  narrative: NarrativeOption;
  baseMetrics: PrecalcMetrics | null;
  horizon: number;
  onExplore: () => void;
}) {
  const m = narrative.metrics;

  return (
    <div
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span
          style={{
            fontSize: "13px",
            fontWeight: 700,
            color: "var(--halo-cyan)",
            textTransform: "uppercase",
            letterSpacing: "1px",
          }}
        >
          Option {narrative.option}
        </span>
        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
          {(narrative.alloc_pct * 100).toFixed(0)}% allocation
        </span>
      </div>

      {/* Note type badge */}
      <div>
        <span
          style={{
            display: "inline-block",
            padding: "3px 10px",
            background: "rgba(0, 212, 255, 0.1)",
            border: "1px solid rgba(0, 212, 255, 0.2)",
            borderRadius: "20px",
            fontSize: "11px",
            color: "var(--halo-cyan)",
            fontWeight: 500,
          }}
        >
          {narrative.note_id}
        </span>
      </div>

      {/* Narrative text */}
      <p style={{ fontSize: "14px", color: "var(--text-primary)", lineHeight: 1.6, margin: 0 }}>
        {narrative.narrative}
      </p>

      {/* Scenario table */}
      <div style={{ fontSize: "12px" }}>
        <div style={{ fontWeight: 600, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {horizon}-Year Scenarios
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "6px 0", color: "var(--text-muted)", fontWeight: 500 }}>Scenario</th>
              <th style={{ textAlign: "right", padding: "6px 0", color: "var(--text-muted)", fontWeight: 500 }}>Before</th>
              <th style={{ textAlign: "right", padding: "6px 0", color: "var(--text-muted)", fontWeight: 500 }}>After</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Bear (P10)</td>
              <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{baseMetrics?.p10?.toFixed(1) ?? "—"}%</td>
              <td style={{ textAlign: "right", color: "var(--text-primary)", fontWeight: 500 }}>{m.p10?.toFixed(1) ?? "—"}%</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Base (P50)</td>
              <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{baseMetrics?.p50?.toFixed(1) ?? "—"}%</td>
              <td style={{ textAlign: "right", color: "var(--text-primary)", fontWeight: 500 }}>{m.p50?.toFixed(1) ?? "—"}%</td>
            </tr>
            <tr>
              <td style={{ padding: "4px 0", color: "var(--text-secondary)" }}>Bull (P90)</td>
              <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>{baseMetrics?.p90?.toFixed(1) ?? "—"}%</td>
              <td style={{ textAlign: "right", color: "var(--text-primary)", fontWeight: 500 }}>{m.p90?.toFixed(1) ?? "—"}%</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Key metrics strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: "8px",
        padding: "12px",
        background: "rgba(0,0,0,0.15)",
        borderRadius: "8px",
      }}>
        <MetricCell
          label="Loss Prob"
          before={baseMetrics?.pct_neg}
          after={m.pct_neg}
          suffix="%"
          lowerIsBetter
        />
        <MetricCell
          label="CVaR"
          before={baseMetrics?.cvar}
          after={m.cvar}
          suffix="%"
          lowerIsBetter
        />
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>Upside Capture</div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
            {m.upside_capture?.toFixed(0) ?? "—"}%
          </div>
        </div>
      </div>

      {/* CTA */}
      <button
        onClick={onExplore}
        style={{
          display: "block",
          width: "100%",
          textAlign: "center",
          padding: "8px",
          fontSize: "13px",
          color: "var(--halo-cyan)",
          background: "transparent",
          border: "none",
          borderTop: "1px solid var(--border)",
          marginTop: "auto",
          cursor: "pointer",
        }}
      >
        Explore this option →
      </button>
    </div>
  );
}


// ── Metric Cell Component ────────────────────────────────────────────────────

function MetricCell({
  label,
  before,
  after,
  suffix = "",
  lowerIsBetter = false,
}: {
  label: string;
  before?: number;
  after?: number;
  suffix?: string;
  lowerIsBetter?: boolean;
}) {
  const improved =
    before != null && after != null
      ? lowerIsBetter
        ? after < before
        : after > before
      : false;

  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: "10px", color: "var(--text-muted)", marginBottom: "4px" }}>{label}</div>
      <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
        {before?.toFixed(1) ?? "—"}{suffix}
      </div>
      <div style={{ fontSize: "14px", fontWeight: 600, color: improved ? "#4ade80" : "var(--text-primary)" }}>
        {after?.toFixed(1) ?? "—"}{suffix}
      </div>
    </div>
  );
}
