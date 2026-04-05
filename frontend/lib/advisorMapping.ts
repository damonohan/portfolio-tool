/**
 * Maps conversational advisor intake answers to framework parameters.
 */

export interface AdvisorAnswers {
  goal: "Growth" | "Income" | "Balanced";
  outlook: "Bullish" | "Neutral" | "Bearish";
  riskTolerance: "Aggressive" | "Moderate" | "Conservative";
  horizon: 1 | 2 | 3;
  clientDescription: string;
  clientConcern: string;
}

export interface FrameworkParams {
  goal: string;
  outlook: string;
  risk_tolerance: string;
  horizon: number;
}

export function mapAdvisorAnswersToParams(answers: AdvisorAnswers): FrameworkParams {
  return {
    goal: answers.goal,
    outlook: answers.outlook,
    risk_tolerance: answers.riskTolerance,
    horizon: answers.horizon,
  };
}

/**
 * Infer note type hint from client concern text.
 * Used to potentially influence filtering or pre-selection.
 */
export function inferNoteTypeHint(concern: string): string | null {
  const lower = concern.toLowerCase();
  if (lower.includes("crash") || lower.includes("drop") || lower.includes("loss"))
    return "downside_protection";
  if (lower.includes("income") || lower.includes("cash") || lower.includes("yield"))
    return "income";
  if (lower.includes("growth") || lower.includes("upside") || lower.includes("return"))
    return "growth";
  return null;
}
