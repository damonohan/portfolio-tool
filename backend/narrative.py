"""
Narrative generation module.
3-tier provider strategy:
  1. Claude API (Haiku) — fast, reliable, zero local RAM
  2. Ollama (local) — preserved for offline/demo use
  3. Template fallback — deterministic, always works
"""

import logging
import os
import httpx

try:
    import anthropic
except ImportError:
    anthropic = None  # Claude provider unavailable — Ollama and template still work

logger = logging.getLogger(__name__)

# ── Configuration ─────────────────────────────────────────────────────────────

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "halo-advisor")
NARRATIVE_PROVIDER = os.getenv("NARRATIVE_PROVIDER", "ollama")  # "claude", "ollama", or "auto"
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-haiku-4-5-20251001")

# Full structured products system prompt (from Modelfile — shared by all providers)
SYSTEM_PROMPT = """You are a structured products specialist at Halo Investing helping financial
advisors explain portfolio changes to clients.

WHAT YOU KNOW:
Structured notes combine a bond with derivatives to customize risk/return. Types include
growth notes (capped upside + buffer/barrier protection), income notes (periodic coupons),
buffer notes (absorb first X% of losses), barrier notes (full protection unless barrier
breached — cliff risk), MLCDs (FDIC-insured), and PPNs (principal-protected).

The core value of incorporating structured notes into a portfolio is reducing volatility drag —
smoother returns compound better over time. A portfolio that avoids deep drawdowns doesn't
need to recover as much to get back to even. This means fewer difficult conversations with
clients about negative returns.

HOW TO TALK ABOUT PORTFOLIOS:
- Talk about the PORTFOLIO, not the note. The note is one ingredient in the mix.
  Say "this portfolio" or "the enhanced portfolio" — not "the note provides" or "the note gives."
  You can mention the note type once for context, but the portfolio gets the credit.
- Lead with what matters most to the client's stated concern.
- Use the practical metrics advisors care about: How often does the portfolio lose money?
  What does a bad year look like? What's the median outcome? How much upside are we giving up?
  How does risk-adjusted return (Sharpe) change?
- Be conversational and direct. Think: how would you explain this across the table to an advisor?
  Not academic, not salesy. Concrete and honest.
- Always end with the tradeoff. Protection has a cost — usually capped upside. Say it plainly.
- 3-4 sentences. No headers, no bullet points, no preamble like "Here is a summary."

COMPLIANCE — ALWAYS:
- You are a calculation tool, not an investment advisor. Never recommend.
- Describe simulation results only. Never imply guaranteed outcomes.
- End with: these results are based on hypothetical Monte Carlo simulation.
- Never say "safe" or "guaranteed" (unless principal-protected, with conditions).
- If barrier breach risk is relevant, mention it explicitly.
"""


def build_narrative_prompt(
    advisor_context: dict,
    base_metrics: dict,
    candidate_metrics: dict,
    note_info: dict,
    horizon: int
) -> str:
    """Build the user prompt for narrative generation."""

    # Extract all metrics
    loss_prob_base = base_metrics.get("pct_neg", 0)
    loss_prob_cand = candidate_metrics.get("pct_neg", 0)
    sharpe_base = base_metrics.get("sharpe", 0)
    sharpe_cand = candidate_metrics.get("sharpe", 0)
    mean_base = base_metrics.get("mean", 0) * 100  # stored as decimal
    mean_cand = candidate_metrics.get("mean", 0) * 100
    std_base = base_metrics.get("std", 0) * 100
    std_cand = candidate_metrics.get("std", 0) * 100

    p10_base = base_metrics.get("p10", 0)
    p10_cand = candidate_metrics.get("p10", 0)
    p50_base = base_metrics.get("p50", 0)
    p50_cand = candidate_metrics.get("p50", 0)
    p90_base = base_metrics.get("p90", 0)
    p90_cand = candidate_metrics.get("p90", 0)

    cvar_base = base_metrics.get("cvar", 0)
    cvar_cand = candidate_metrics.get("cvar", 0)

    upside_capture = candidate_metrics.get("upside_capture", 100)
    alloc_pct = note_info.get("alloc_pct", 10)
    note_type = note_info.get("note_type", "structured note")
    protection_pct = note_info.get("protection_pct", 0)

    # Pre-compute all deltas so the LLM never has to do math
    loss_delta = loss_prob_base - loss_prob_cand  # positive = fewer losses = better
    sharpe_delta = sharpe_cand - sharpe_base      # positive = better risk-adjusted
    p10_delta = p10_cand - p10_base
    p50_delta = p50_cand - p50_base
    p90_delta = p90_cand - p90_base
    cvar_delta = cvar_cand - cvar_base            # positive = less severe tail = better
    vol_delta = std_cand - std_base               # negative = smoother = better

    def direction(delta, better_when_positive=True):
        if abs(delta) < 0.05:
            return "unchanged"
        if better_when_positive:
            return "better" if delta > 0 else "worse"
        return "better" if delta < 0 else "worse"

    prompt = f"""Portfolio: {alloc_pct:.0f}% in a {note_type} (protection: {protection_pct:.0f}%), rest in base mix. {horizon}-year horizon.

Client: {advisor_context.get('client_description', 'Not specified.')}
Concern: {advisor_context.get('client_concern', 'general market risk')}. Goal: {advisor_context.get('goal', 'Balanced')}.

HYPOTHETICAL simulation across 10,000 scenarios — all numbers pre-computed, use as-is:

NEGATIVE RETURN FREQUENCY: {loss_prob_base:.1f}% → {loss_prob_cand:.1f}% ({direction(loss_delta)}, {abs(loss_delta):.1f}pp change). This is how often you'd have a difficult conversation with the client about losses.

RISK-ADJUSTED RETURN (Sharpe): {sharpe_base:.2f} → {sharpe_cand:.2f} ({direction(sharpe_delta)}).

VOLATILITY: {std_base:.1f}% → {std_cand:.1f}% ({direction(vol_delta, better_when_positive=False)}). Lower volatility means less drag on compounding.

SCENARIOS:
- Bad year (P10): {p10_base:.1f}% → {p10_cand:.1f}% ({direction(p10_delta)})
- Typical year (P50): {p50_base:.1f}% → {p50_cand:.1f}%
- Strong year (P90): {p90_base:.1f}% → {p90_cand:.1f}% ({direction(p90_delta)})

TAIL RISK (CVaR, avg of worst 10%): {cvar_base:.1f}% → {cvar_cand:.1f}% ({direction(cvar_delta)})

UPSIDE CAPTURE: {upside_capture:.0f}% of base portfolio gains retained.

Write EXACTLY 3-4 sentences for the advisor. Rules:
1. FIRST WORD must be a content word like "This", "By", "The", "With", "Across" — NEVER start with "Here" or any meta-commentary.
2. Use pre-computed directions as-is. Do not recalculate.
3. Pick the 2-3 most meaningful changes for this client's concern.
4. Mix traditional metrics (loss frequency, Sharpe, volatility) with scenario outcomes.
5. Credit the portfolio, not the note. Say "this portfolio" not "the note provides."
6. Last sentence = the tradeoff + "based on hypothetical Monte Carlo simulation."
"""
    return prompt.strip()


# ── Provider implementations ──────────────────────────────────────────────────

async def _generate_with_claude(prompt: str, timeout: float = 30.0) -> str:
    """Call Claude Haiku via the Anthropic API."""
    if anthropic is None:
        raise RuntimeError("anthropic SDK not installed")
    client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY, timeout=timeout)
    message = await client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=300,
        system=SYSTEM_PROMPT,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
    )
    return message.content[0].text.strip()


_ollama_client: httpx.AsyncClient | None = None


def _get_ollama_client() -> httpx.AsyncClient:
    """Reuse a single httpx client across all Ollama calls."""
    global _ollama_client
    if _ollama_client is None or _ollama_client.is_closed:
        _ollama_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_connections=1, max_keepalive_connections=1),
        )
    return _ollama_client


async def _generate_with_ollama(prompt: str, timeout: float = 30.0) -> str:
    """Call Ollama local model."""
    client = _get_ollama_client()
    response = await client.post(
        f"{OLLAMA_BASE_URL}/api/generate",
        json={
            "model": OLLAMA_MODEL,
            "system": SYSTEM_PROMPT,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": 200,
            },
            "keep_alive": "5m",
        }
    )
    response.raise_for_status()
    data = response.json()
    return data.get("response", "").strip()


# ── Main entry point ──────────────────────────────────────────────────────────

async def generate_narrative(
    advisor_context: dict,
    base_metrics: dict,
    candidate_metrics: dict,
    note_info: dict,
    horizon: int,
    timeout: float = 30.0
) -> str:
    """
    Generate a narrative using the 3-tier provider strategy.
    Claude API → Ollama → Template fallback.
    """
    prompt = build_narrative_prompt(
        advisor_context, base_metrics, candidate_metrics, note_info, horizon
    )

    provider = NARRATIVE_PROVIDER

    # Auto-detect provider
    if provider == "auto":
        provider = "claude" if ANTHROPIC_API_KEY else "ollama"

    # Tier 1: Claude API
    if provider == "claude":
        try:
            return await _generate_with_claude(prompt, timeout=timeout)
        except Exception as e:
            logger.warning("Claude generation failed: %s", e)

    # Tier 2: Ollama (local)
    if provider in ("ollama", "claude"):  # claude falls through here on failure
        try:
            return await _generate_with_ollama(prompt, timeout=timeout)
        except Exception as e:
            logger.warning("Ollama generation failed: %s", e)

    # Tier 3: Template fallback (always works)
    return _template_narrative(base_metrics, candidate_metrics, note_info, horizon)


def _template_narrative(base_metrics: dict, candidate_metrics: dict, note_info: dict, horizon: int) -> str:
    """Deterministic fallback when both Claude and Ollama are unavailable."""
    loss_delta = base_metrics.get("pct_neg", 0) - candidate_metrics.get("pct_neg", 0)
    p10_improvement = candidate_metrics.get("p10", 0) - base_metrics.get("p10", 0)
    upside = candidate_metrics.get("upside_capture", 100)
    alloc = note_info.get("alloc_pct", 10)

    return (
        f"Adding this {note_info.get('note_type', 'structured note')} at {alloc:.0f}% of the portfolio "
        f"reduces the probability of loss by {loss_delta:.1f} percentage points over the {horizon}-year horizon. "
        f"In a down market scenario, the portfolio performs approximately {abs(p10_improvement):.1f}% better than the base portfolio. "
        f"The tradeoff is that in strong markets, the enhanced portfolio captures roughly {upside:.0f}% of the upside "
        f"compared to the unmodified portfolio. "
        f"These results are based on hypothetical Monte Carlo simulation and do not guarantee future investment outcomes."
    )
