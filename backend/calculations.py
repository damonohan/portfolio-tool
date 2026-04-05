"""
Core calculation engine for portfolio analysis.
All operations vectorized with pandas/numpy.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from scipy import stats
from typing import Any


# ── helpers ────────────────────────────────────────────────────────────────────

def compute_cumulative_returns(df: pd.DataFrame, columns: list[str], horizon: int) -> pd.DataFrame:
    """
    Given the full simulation DataFrame, compute the final cumulative return per
    simulation for the given columns over `horizon` periods (1, 2, or 3).

    Returns a DataFrame indexed by simulation with one column per input column.
    """
    periods = list(range(horizon))           # periods 0 … horizon-1
    sub = df[df["Period"].isin(periods)].copy()

    # Cumulative product of (1 + r) across periods, then subtract 1
    wealth = sub.groupby("Simulation")[columns].apply(
        lambda g: (1 + g).prod() - 1
    )
    return wealth                            # shape: (n_sims, len(columns))


def portfolio_returns(cum_df: pd.DataFrame, weights: dict[str, float]) -> np.ndarray:
    """
    Compute the weighted portfolio final return for each simulation.

    weights: {asset_name: weight_as_fraction}  (fractions must sum to 1)
    cum_df: DataFrame with one column per asset, one row per simulation.
    """
    cols = list(weights.keys())
    w = np.array([weights[c] for c in cols])
    return cum_df[cols].values @ w          # shape: (n_sims,)


def compute_metrics(final_returns: np.ndarray, risk_free_rate: float, horizon: int = 1) -> dict[str, float]:
    """Compute all required metrics from an array of final cumulative returns.

    Mean, std, and Sharpe are annualized so they are comparable across horizons.
    pct_neg and shorty use the raw cumulative returns (total-outcome measures).
    """
    rfr = risk_free_rate / 100.0
    # Annualize: convert cumulative returns to equivalent annual returns
    ann_returns = (1 + final_returns) ** (1.0 / horizon) - 1
    mean = float(np.mean(ann_returns))
    std  = float(np.std(ann_returns, ddof=1))
    sharpe = (mean - rfr) / std if std > 0 else 0.0
    pct_neg = float(np.sum(final_returns < 0) / len(final_returns) * 100)
    shorty  = float(stats.kurtosis(final_returns, fisher=True))   # excess kurtosis
    # Downside kurtosis: excess kurtosis of negative returns only (barrier tail risk)
    downside = final_returns[final_returns < 0]
    downside_kurt = float(stats.kurtosis(downside, fisher=True)) if len(downside) > 30 else 0.0
    return {
        "mean":          mean,
        "std":           std,
        "sharpe":        sharpe,
        "pct_neg":       pct_neg,
        "shorty":        shorty,
        "downside_kurt": downside_kurt,
        "cvar":          float(compute_cvar(final_returns, alpha=0.10)),
        "p10":           float(compute_percentiles(final_returns)["p10"]),
        "p50":           float(compute_percentiles(final_returns)["p50"]),
        "p90":           float(compute_percentiles(final_returns)["p90"]),
    }


# ── new risk metrics ──────────────────────────────────────────────────────────

def compute_cvar(returns: np.ndarray, alpha: float = 0.10) -> float:
    """
    Expected Shortfall at the alpha level.
    Returns the mean of the worst (alpha * 100)% of outcomes.

    Args:
        returns: 1D array of cumulative returns (fractions, e.g. -0.15 = -15%)
        alpha: tail probability (default 0.10 = worst 10%)

    Returns:
        CVaR as a fraction (e.g. -0.12 = expected loss of 12% in worst 10% of scenarios).
        Returned as percentage points in API output (multiply by 100).
    """
    threshold = np.percentile(returns, alpha * 100)
    tail = returns[returns <= threshold]
    return float(np.mean(tail)) if len(tail) > 0 else float(threshold)


def compute_percentiles(returns: np.ndarray, percentiles: list = [10, 50, 90]) -> dict:
    """
    Compute named scenario anchors from the return distribution.
    P10 = bear case, P50 = base case, P90 = bull case.

    Args:
        returns: 1D array of cumulative returns (fractions)
        percentiles: list of percentile values to compute

    Returns:
        Dict of {"p10": float, "p50": float, "p90": float} as fractions.
        Returned as percentage points in API output (multiply by 100).
    """
    result = {}
    for p in percentiles:
        result[f"p{p}"] = float(np.percentile(returns, p))
    return result


def barrier_breach_probability(note_cum_returns: np.ndarray, barrier_pct: float) -> float:
    """
    Fraction of simulations where the note's cumulative return falls below -barrier_pct.
    Captures the 'cliff risk' for barrier/buffer notes explicitly.

    Args:
        note_cum_returns: 1D array of cumulative returns for the note column (fractions)
        barrier_pct: barrier level as a percentage (e.g. 30.0 = 30% barrier)

    Returns:
        Breach probability as a fraction (e.g. 0.08 = 8% of simulations breach the barrier).
        Returned as percentage points in API output (multiply by 100).

    Note: If barrier_pct is 0 or not applicable for the note type, return 0.0.
    """
    if barrier_pct <= 0:
        return 0.0
    threshold = -(barrier_pct / 100.0)
    breaches = np.sum(note_cum_returns < threshold)
    return float(breaches / len(note_cum_returns))


def upside_capture_rate(candidate_returns: np.ndarray, base_returns: np.ndarray) -> float:
    """
    In simulations where the BASE portfolio is positive, what fraction of that
    upside does the CANDIDATE portfolio capture?

    Formula: mean(candidate_returns[base > 0]) / mean(base_returns[base > 0])

    Returns:
        Ratio as a fraction (e.g. 0.85 = captures 85% of upside).
        Returned as a percentage in API output (multiply by 100).
        Returns 1.0 if no positive base scenarios exist.
    """
    positive_mask = base_returns > 0
    if positive_mask.sum() == 0:
        return 1.0
    base_up = np.mean(base_returns[positive_mask])
    cand_up = np.mean(candidate_returns[positive_mask])
    if base_up == 0:
        return 1.0
    return float(cand_up / base_up)


def expected_income(weights: dict[str, float], yields: dict[str, float]) -> float:
    """Σ (weight × expected_yield) for asset classes."""
    return sum(weights.get(a, 0.0) * yields.get(a, 0.0) for a in yields)


# ── framework look-up tables ───────────────────────────────────────────────────

NOTE_TYPES_GROWTH = {"Growth", "Digital", "Absolute", "Snowball"}
NOTE_TYPES_INCOME  = {"Income", "MLCD", "PPN"}
ALL_BUCKETS = {"Equity", "Fixed Income", "Alternative", "Cash"}


def framework_params(
    outlook: str,
    risk_tolerance: str,
    goal: str,
    note_type: str,
) -> tuple[set[str], float]:
    """
    Returns (allowed_buckets, max_pct_fraction) for a given note under the
    chosen framework parameters.

    Returns (empty set, 0) when the note is excluded by the goal filter.
    """
    # ── Goal filter ──────────────────────────────────────────────────────────
    if goal == "Growth" and note_type not in NOTE_TYPES_GROWTH:
        return set(), 0.0
    if goal == "Income" and note_type not in NOTE_TYPES_INCOME:
        return set(), 0.0
    # "Balanced" → any note passes

    # ── Outlook → buckets & outlook max ─────────────────────────────────────
    if outlook == "Bullish":
        if note_type not in NOTE_TYPES_GROWTH:
            return set(), 0.0
        buckets  = {"Equity"}
        out_max  = 0.35          # mid of 30–40 %
    elif outlook == "Bearish":
        if note_type not in NOTE_TYPES_INCOME:
            return set(), 0.0
        buckets  = {"Equity", "Fixed Income"}
        out_max  = 0.40
    else:                        # Neutral
        buckets  = ALL_BUCKETS.copy()
        out_max  = 0.20

    # ── Income notes prefer Fixed Income / Cash ──────────────────────────────
    if note_type in NOTE_TYPES_INCOME:
        buckets &= {"Fixed Income", "Cash", "Equity"}  # keep overlap or relax
        if not buckets:
            buckets = {"Fixed Income", "Cash"}

    # ── Risk tolerance cap ───────────────────────────────────────────────────
    risk_max_map = {
        "Conservative": 0.175,  # mid 15–20 %
        "Moderate":     0.275,  # mid 25–30 %
        "Aggressive":   0.375,  # mid 35–40 %
    }
    risk_max = risk_max_map.get(risk_tolerance, 0.25)

    max_pct = min(out_max, risk_max)
    return buckets, max_pct


# ── scoring ───────────────────────────────────────────────────────────────────

def rank_score(
    base: dict[str, float],
    cand: dict[str, float],
    goal: str,
) -> float:
    """
    Higher is better.  Weights depend on framework goal.
    """
    w_sharpe   = 1.0
    w_neg      = 1.0
    w_shorty   = 0.5
    w_downside = 0.5
    w_income   = 0.5 if goal == "Income" else 0.0 if goal == "Growth" else 0.1

    score = (
        w_sharpe   * (cand["sharpe"]        - base["sharpe"])
        - w_neg    * (cand["pct_neg"]       - base["pct_neg"])
        - w_shorty * (cand["shorty"]        - base["shorty"])
        - w_downside * (cand.get("downside_kurt", 0) - base.get("downside_kurt", 0))
        + w_income * cand.get("income_boost", 0.0)
    )
    return float(score)


# ── main improvement search ───────────────────────────────────────────────────

def find_improvements(
    df: pd.DataFrame,
    base_weights: dict[str, float],          # {asset: fraction}
    asset_buckets: dict[str, str],           # {asset: bucket_name}
    asset_yields: dict[str, float],          # {asset: annual_yield_%/100}
    note_columns: list[str],                 # raw df column names for notes
    note_meta: dict[str, dict[str, Any]],   # {raw_col: {type, yield_pct}}
    horizon: int,
    risk_free: float,
    outlook: str,
    risk_tolerance: str,
    goal: str,
    base_metrics: dict[str, float],
    base_income: float,
    note_id_map: dict[str, str] | None = None,  # {raw_col: clean_id}
) -> list[dict[str, Any]]:
    """
    Evaluate every (note, allocation%) candidate and return ranked top-5.
    """
    asset_cols = list(base_weights.keys())
    all_cols   = asset_cols + note_columns

    # Pre-compute cumulative returns for all assets + notes at once
    cum_df = compute_cumulative_returns(df, all_cols, horizon)

    candidates: list[dict[str, Any]] = []

    for note_col in note_columns:
        # Use clean numeric ID if mapping provided, else fall back to column name
        note_id   = (note_id_map or {}).get(note_col, note_col)
        ntype_raw = note_meta.get(note_col, {}).get("type", "")
        note_type = ntype_raw

        allowed_buckets, max_pct = framework_params(outlook, risk_tolerance, goal, note_type)
        if not allowed_buckets or max_pct == 0:
            continue

        # note yield_pct stored as % (e.g. 3.5); convert to fraction to match asset_yields units
        _meta = note_meta.get(note_col, {})
        is_income = _meta.get("income_eligible", note_type in NOTE_TYPES_INCOME)
        note_yield_pct = (_meta.get("yield_pct", 0.0) / 100.0) if is_income else 0.0

        # Assets belonging to allowed buckets
        bucket_assets = [a for a, b in asset_buckets.items() if b in allowed_buckets and a in base_weights]
        if not bucket_assets:
            continue
        bucket_total = sum(base_weights[a] for a in bucket_assets)
        if bucket_total <= 0:
            continue

        # Try 5% increments up to max_pct
        step = 0.05
        pct  = step
        while pct <= max_pct + 1e-9:
            alloc = round(pct, 4)
            if alloc > bucket_total + 1e-6:
                pct += step
                continue

            # New weights: reduce bucket assets pro-rata, add note
            new_weights = dict(base_weights)
            for a in bucket_assets:
                new_weights[a] = base_weights[a] - (base_weights[a] / bucket_total) * alloc
            # Note treated as additional column; portfolio return is dot-product
            new_asset_w = {a: w for a, w in new_weights.items() if a in asset_cols}
            note_portion = alloc

            # Weighted sum: asset portion + note portion
            asset_ret = cum_df[asset_cols].values @ np.array([new_asset_w[a] for a in asset_cols])
            note_ret  = cum_df[note_col].values * note_portion
            port_ret  = asset_ret + note_ret

            m = compute_metrics(port_ret, risk_free, horizon)

            # Income %
            new_income_pct = sum(new_weights.get(a, 0.0) * asset_yields.get(a, 0.0) for a in asset_cols)
            if is_income:
                new_income_pct += alloc * note_yield_pct
            income_boost = new_income_pct - base_income

            # Acceptance: at least one criterion improves
            improves = (
                m["sharpe"]        >= base_metrics["sharpe"]        or
                m["pct_neg"]       <= base_metrics["pct_neg"]       or
                m["shorty"]        <= base_metrics["shorty"]        or
                m["downside_kurt"] <= base_metrics["downside_kurt"] or
                (is_income and income_boost > 0)
            )
            if improves:
                score = rank_score(base_metrics, m, goal)
                candidates.append({
                    "note_id":      note_id,
                    "note_type":    note_type,
                    "alloc_pct":    round(alloc * 100, 1),
                    "new_sharpe":   round(m["sharpe"],  4),
                    "new_pct_neg":  round(m["pct_neg"], 4),
                    "new_shorty":   round(m["shorty"],  4),
                    "income_boost": round(income_boost, 4),
                    "score":        round(score, 6),
                    "port_returns": port_ret.tolist(),   # 10k floats – trimmed before send
                })
            pct += step

    # Rank
    candidates.sort(key=lambda x: x["score"], reverse=True)

    # Deduplicate by note_id (keep best alloc per note)
    seen: set[str] = set()
    top: list[dict] = []
    for c in candidates:
        if c["note_id"] not in seen:
            seen.add(c["note_id"])
            top.append(c)
        if len(top) == 5:
            break

    return top
