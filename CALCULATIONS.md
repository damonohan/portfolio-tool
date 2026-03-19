# Calculation Methodology

This document describes every mathematical and algorithmic decision made in the Portfolio Note Allocation Tool. All computation lives in `backend/calculations.py` and is called from `backend/main.py`.

---

## Table of Contents
1. [Data Shape & Units](#data-shape--units)
2. [Cumulative Return Computation](#cumulative-return-computation)
3. [Portfolio Return Vector](#portfolio-return-vector)
4. [Portfolio Statistics](#portfolio-statistics)
5. [Expected Income](#expected-income)
6. [Framework Constraint System](#framework-constraint-system)
7. [Candidate Generation](#candidate-generation)
8. [Rebalancing Logic](#rebalancing-logic)
9. [Acceptance Criteria](#acceptance-criteria)
10. [Scoring & Ranking](#scoring--ranking)
11. [Deduplication & Top-5 Selection](#deduplication--top-5-selection)
12. [Histogram Generation](#histogram-generation)
13. [Units Reference](#units-reference)

---

## Data Shape & Units

The uploaded `.xlsx` file is parsed into a pandas DataFrame with the following shape:

```
Rows:    n_simulations × n_periods
         (e.g. 10,000 simulations × 3 periods = 30,000 rows)

Columns:
  Simulation  — integer simulation ID (1 … N)
  Period      — integer period index (0-based; 0 = Year 1)
  [asset_1]   — period return as a fraction  (e.g. 0.07 = 7%)
  [asset_2]
  …
  ('Note', 'ID_1')  — period return as a fraction
  ('Note', 'ID_2')
  …
```

**Key unit conventions used throughout:**
- All return values in the DataFrame are **fractions** (not percentages)
- Asset and note annual yields are stored as **percentages** (e.g. `2.0` = 2% per year)
- Portfolio weights are stored internally as **fractions** (e.g. `0.40` = 40%)
- Metric outputs: Sharpe and Shorty are dimensionless; `pct_neg` is in **percentage points**; `mean` and `std` are **fractions**; `expected_income_pct` is in **percentage points**

---

## Cumulative Return Computation

**Function:** `compute_cumulative_returns(df, columns, horizon)`

For a given investment horizon (1, 2, or 3 years), the cumulative return for each simulation path is computed as the compound product of single-period returns.

**Steps:**
1. Filter the DataFrame to periods `[0, 1, ..., horizon-1]`
2. Group rows by `Simulation`
3. For each simulation, for each column, compute:

```
cumulative_return = (1 + r_0) × (1 + r_1) × … × (1 + r_{horizon-1})  −  1
```

This is equivalent to `∏(1 + r_t) − 1` over the selected periods.

**Result:** A DataFrame of shape `(n_simulations × n_columns)`, where each cell is the total compounded return for that simulation path over the horizon.

**Example** (3-year horizon, one asset):
```
Period 0:  r = +0.05  →  1.05
Period 1:  r = −0.02  →  1.029
Period 2:  r = +0.08  →  1.11132
Cumulative return = 1.11132 − 1 = 0.11132  (≈ 11.1%)
```

---

## Portfolio Return Vector

**Function:** `portfolio_returns(cum_df, weights)`

Given the cumulative return matrix and a set of portfolio weights, the portfolio-level return for each simulation is the weighted sum of asset returns:

```
portfolio_return[sim] = Σ  weight[a] × cumulative_return[a, sim]
                         a
```

Implemented as a matrix–vector dot product:

```python
cum_df[asset_cols].values @ weights_vector   # shape: (n_sims,)
```

Weights must sum to 1.0 (enforced on save in the portfolio builder).

---

## Portfolio Statistics

**Function:** `compute_metrics(final_returns, risk_free_rate, horizon)`

All statistics are computed over the full distribution of `n_simulations` portfolio returns. Mean, Std, and Sharpe are **annualized** to enable comparison across different investment horizons.

### Annualization

Cumulative returns are converted to annualized equivalents before computing Mean, Std, and Sharpe:

```
ann_return[sim] = (1 + cumulative_return[sim]) ^ (1 / horizon) − 1
```

For a 1-year horizon this is a no-op. For multi-year horizons it extracts the equivalent per-year return.

### Metrics

| Metric | Formula | Direction | Annualized? |
|--------|---------|-----------|-------------|
| **Mean** | `np.mean(ann_returns)` | Higher is better | Yes |
| **Std** | `np.std(ann_returns, ddof=1)` | Lower is better | Yes (std of annualized returns) |
| **Sharpe** | `(mean − rfr) / std` | Higher is better | Yes — uses annualized mean & std; rfr = risk_free_rate / 100 |
| **% Negative** | `100 × count(cumulative_r < 0) / n_sims` | Lower is better | No — uses raw cumulative returns |
| **Shorty** | `scipy.stats.kurtosis(cumulative_returns, fisher=True)` | Lower is better | No — uses raw cumulative returns |

### Sharpe Ratio
The Sharpe ratio uses annualized returns for cross-horizon comparability. The risk-free rate input is the **annual** rate in % (e.g. `2.0` = 2%) and is divided by 100 to get the fractional hurdle (e.g. `0.02`). When `std = 0`, Sharpe is returned as `0.0`.

**Note:** Even with annualization, the Sharpe ratio may increase with longer horizons. This is the well-known "time diversification" effect — annualized volatility from compounded returns decreases roughly as `1/√horizon` while annualized mean stays roughly constant.

### Shorty (Excess Kurtosis)
The "Shorty" metric is excess kurtosis — how much heavier the tails of the return distribution are compared to a normal distribution. A value of 0 is normal; positive values indicate fat tails (more extreme outcomes than normal). Lower Shorty is preferred as it implies more predictable tail behaviour. Computed from **raw cumulative returns** (not annualized).

---

## Expected Income

**Function:** `expected_income(weights, yields)`

```
expected_income_pct = Σ  weight[a] × annual_yield_pct[a]
                       a
```

- `weight[a]` is a fraction (0–1)
- `annual_yield_pct[a]` is in percentage points (e.g. `2.0` = 2%)
- Result is in **percentage points** and represents the portfolio's weighted average expected annual income yield

This value is **not** multiplied by 100 anywhere — it is already in %. When a note is added, the expected income from that note is:

```
note_income_contribution = alloc_fraction × note_yield_pct    (if Income type only)
```

All other note types (Growth, Digital, Absolute, MLCD, PPN) contribute 0 to expected income.

---

## Framework Constraint System

The framework uses a **27-cell configurable grid** (3 Outlooks × 3 Risk Tolerances × 3 Goals). Each cell independently controls which notes are eligible and at what maximum allocation.

### Cell Key Format

```
"{outlook}|{risk_tolerance}|{goal}"
```
Example: `"Bullish|Moderate|Growth"`

### Cell Parameters

Each of the 27 cells contains:

| Parameter | Type | Description |
|-----------|------|-------------|
| `allowed_types` | list | Note types allowed (e.g. `["Growth", "Digital", "Absolute"]`). Empty = all types. |
| `allowed_underlyings` | list | Allowed note underliers (e.g. `["SPX", "RUT"]`). Empty = no filter. |
| `allowed_protection_types` | list | Allowed protection types (e.g. `["Soft", "Hard"]`). Empty = no filter. |
| `min_protection_pct` | float | Minimum protection % required (default `0.0`). |
| `max_protection_pct` | float | Maximum protection % allowed (default `100.0`). |
| `max_alloc_pct` | float | Maximum note allocation as % (default `30.0`). |

### Outlook Buckets

The framework also defines which asset buckets each outlook draws from during rebalancing:

| Outlook | Allowed Buckets |
|---------|-----------------|
| Bullish | Equity |
| Neutral | Equity, Fixed Income, Alternative, Cash |
| Bearish | Equity, Fixed Income |

### Default Allowed Types by Outlook

| Outlook | Default `allowed_types` |
|---------|------------------------|
| Bullish | Growth, Digital, Absolute |
| Neutral | Growth, Digital, Absolute, Income, MLCD, PPN |
| Bearish | Income, MLCD, PPN |

For **Balanced** goal cells, all note types are allowed regardless of outlook.

### Filtering (applied at improvement search time)

A candidate is included only if **all** of the following pass for its framework cell:

1. `alloc_pct ≤ max_alloc_pct`
2. `note_type ∈ allowed_types` (if list is non-empty)
3. `underlier ∈ allowed_underlyings` (if list is non-empty)
4. `protection_type ∈ allowed_protection_types` (if list is non-empty)
5. `min_protection_pct ≤ protection_pct ≤ max_protection_pct`

### Configuration Endpoints

- `GET /framework-config` — returns current 27-cell config + outlook buckets
- `POST /framework-config` — updates config, saves to DB, re-runs pre-calculation for all portfolios
- `POST /framework-config/reset` — resets to built-in defaults, re-runs pre-calculation

### Legacy Note

The original 3-gate system (Goal → Outlook → Risk Tolerance Cap) documented in earlier versions has been fully replaced by this flexible framework. The `framework_params()` function in `calculations.py` is retained but unused.

---

## Candidate Generation (Two-Phase Architecture)

Candidate evaluation uses a two-phase approach for performance: **pre-calculation** (compute once per portfolio) and **filtering** (apply per framework cell on demand).

### Phase 1 — Pre-Calculation

**Function:** `_run_precalc(portfolio_name)` in `main.py`

Triggered when a portfolio is saved or the framework config changes. For each portfolio:

1. Compute cumulative returns for all assets and notes at horizons 1, 2, and 3
2. Compute **base metrics** (Sharpe, pct_neg, shorty, mean, std, expected_income) for each horizon
3. For each of the 3 outlooks (Bullish, Neutral, Bearish):
   - Determine allowed asset buckets from `outlook_buckets` config
   - Identify bucket assets and their total weight (`bucket_total`)
   - For each horizon, for each note:
     - Test allocations in **5% steps from 5% to 40%** (flat ceiling for all cells)
     - Pro-rata reduce bucket assets, compute new portfolio returns and metrics
     - Apply acceptance criteria (see Section 9)
     - Store accepted candidates with metrics (but **not** full 10k return arrays — only summary stats)

Pre-calculated results are stored in `SESSION["precalc"][portfolio_name]` with structure:
```
{
  "_base": { "1": {metrics}, "2": {metrics}, "3": {metrics} },
  "Bullish": { "1": [candidates], "2": [candidates], "3": [candidates] },
  "Neutral": { ... },
  "Bearish": { ... }
}
```

### Phase 2 — Framework Filtering

**Endpoint:** `POST /find-improvements`

When the user requests improvements with a specific (outlook, risk_tolerance, goal, horizon):

1. Retrieve pre-computed candidates for the selected outlook and horizon
2. Look up the framework cell config for `"{outlook}|{risk_tolerance}|{goal}"`
3. Filter candidates by all cell rules (types, underliers, protection, max allocation — see Section 6)
4. Score remaining candidates via `rank_score()` (see Section 10)
5. Deduplicate by note ID, take top 5 (see Section 11)
6. **Re-compute full portfolio return arrays** (10k floats) for the top 5 only — needed for histograms

This separation means the expensive simulation work is done once, and framework changes only require re-filtering.

---

## Rebalancing Logic

When adding a note at `alloc` fraction, the bucket assets are reduced **pro-rata** to make room:

```
new_weight[a] = base_weight[a]  −  (base_weight[a] / bucket_total) × alloc
```

This preserves the **relative proportions** of assets within the affected bucket while reducing their collective weight by exactly `alloc`. Assets outside the allowed buckets are unchanged.

**Example:**
```
Allowed bucket: Equity
Equity assets:  US Large Cap 30%, US Small Cap 10%  (bucket_total = 0.40)
alloc = 0.10 (10%)

Reduction for US Large Cap:  (0.30 / 0.40) × 0.10 = 0.075  →  new weight = 0.225
Reduction for US Small Cap:  (0.10 / 0.40) × 0.10 = 0.025  →  new weight = 0.075

Note allocation:  0.10
Total check:  0.225 + 0.075 + 0.10 + (all other unchanged) = same as before
```

The note does **not** appear as a named asset weight. Instead, its return contribution is added directly when computing portfolio returns:

```
portfolio_return[sim] = (Σ new_asset_weight[a] × cum_return[a, sim])
                       + alloc × cum_return[note_col, sim]
```

---

## Acceptance Criteria

A candidate (note + allocation) is only added to the results pool if it satisfies **at least one** of the following conditions relative to the base portfolio:

| Condition | Meaning |
|-----------|---------|
| `new_sharpe ≥ base_sharpe` | Risk-adjusted return does not get worse |
| `new_pct_neg ≤ base_pct_neg` | Fewer simulations end in loss |
| `new_shorty ≤ base_shorty` | Tails are not heavier |
| `note_type == "Income" AND income_boost > 0` | Income note adds expected yield |

This OR-logic ensures candidates that excel on one dimension are not excluded for being neutral on others.

---

## Scoring & Ranking

**Function:** `rank_score(base, candidate, goal)`

Accepted candidates are assigned a composite score. **Higher score = better candidate.** All metric deltas use **annualized** values (since both base and candidate metrics are annualized by `compute_metrics`).

```
score = w_sharpe × (new_sharpe  − base_sharpe)
      − w_neg    × (new_pct_neg − base_pct_neg)
      − w_shorty × (new_shorty  − base_shorty)
      + w_income × income_boost
```

### Weights

| Term | Weight | Rationale |
|------|--------|-----------|
| Δ Sharpe | 1.0 | Risk-adjusted return improvement is the primary goal |
| Δ % Negative | 1.0 | Downside protection equally important as return |
| Δ Shorty | 0.5 | Tail risk matters, but half as much as mean/downside |
| Income Boost | 0.5 (Income goal) / 0.1 (other) | Income-focused portfolios weight yield 5× more heavily |

### Sign Convention
- **Sharpe:** higher is better → reward an increase (positive term)
- **% Negative:** lower is better → penalise an increase (negative term); a reduction (negative Δ) gives a positive contribution
- **Shorty:** lower is better → same as % Negative
- **Income Boost:** higher is better → always a positive term

### Income Boost Calculation

```
new_income_pct = Σ new_asset_weight[a] × asset_yield_pct[a]
              + (alloc × note_yield_pct  if  note_type == "Income")

income_boost = new_income_pct − base_income_pct
```

Units: percentage points. A boost of `0.5` means the portfolio's expected annual income yield increases by 0.5 percentage points.

Note yield (`yield_pct`) is stored as a percentage (e.g. `3.5` = 3.5%) and divided by 100 before multiplication by `alloc` (a fraction), so the contribution is in the same units as the asset-yield sum.

---

## Deduplication & Top-5 Selection

After all candidates are scored:

1. Sort descending by `score`
2. Walk the sorted list; for each note ID, keep only the **first occurrence** (highest-scored allocation)
3. Stop once 5 unique note IDs have been collected

This means the table always shows the single best allocation for each note, not multiple allocations of the same note.

---

## Histogram Generation

**Endpoint:** `GET /histogram/{index}`

For a given improvement candidate (by rank index), an overlay histogram is generated comparing:

- **Base portfolio** return distribution (steelblue, label: portfolio name)
- **Candidate** return distribution (darkorange, label: `Note ID @ Alloc%`)

Configuration:
- Both distributions rendered as **probability density** (area sums to 1), enabling visual shape comparison regardless of scale
- 80 bins each
- Returns multiplied by 100 for display (shown as %)
- Red dashed vertical line at x = 0 marks the breakeven point

The histogram data is returned as a Plotly JSON object and rendered client-side via `react-plotly.js`.

---

## Units Reference

| Quantity | Stored As | Example |
|----------|----------|---------|
| Asset / note returns (DataFrame) | Fraction | `0.07` = 7% |
| Portfolio weights (session) | Fraction | `0.40` = 40% |
| Portfolio weights (API input/output) | Percentage | `40` = 40% |
| Asset annual yield | Percentage | `2.0` = 2% pa |
| Note annual yield | Percentage | `3.5` = 3.5% pa |
| Risk-free rate | Percentage | `2.0` = 2% pa |
| Mean return (metric output) | Fraction (annualized) | `0.062` = 6.2% pa |
| Std (metric output) | Fraction (annualized) | `0.12` = 12% pa |
| Sharpe ratio | Dimensionless (annualized) | `0.45` |
| % Negative | Percentage points | `12.3` = 12.3% of simulations |
| Shorty (excess kurtosis) | Dimensionless | `1.4` |
| Expected income | Percentage points | `1.8` = 1.8% pa |
| Income boost | Percentage points | `0.4` = adds 0.4% pa |
