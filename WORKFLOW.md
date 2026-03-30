# Portfolio Note Allocation Tool — Technical Workflow Document

> **Audience:** Development teams implementing this system
> **Version:** March 2026
> **Source:** [github.com/damonohan/portfolio-tool](https://github.com/damonohan/portfolio-tool)

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [End-to-End Workflow](#2-end-to-end-workflow)
3. [Input Specification](#3-input-specification)
4. [Data Pipeline](#4-data-pipeline)
5. [Calculation Engine](#5-calculation-engine)
6. [Framework Constraint System (27-Cell Grid)](#6-framework-constraint-system-27-cell-grid)
7. [Two-Phase Candidate Processing](#7-two-phase-candidate-processing)
8. [Rebalancing Logic](#8-rebalancing-logic)
9. [Filtering Pipeline](#9-filtering-pipeline)
10. [Acceptance Criteria](#10-acceptance-criteria)
11. [Scoring & Ranking](#11-scoring--ranking)
12. [Deduplication & Top-5 Selection](#12-deduplication--top-5-selection)
13. [Output Specification](#13-output-specification)
14. [Constants & Reference Tables](#14-constants--reference-tables)

---

## 1. System Architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │                        BROWSER (Next.js 16)                        │
 │                                                                     │
 │  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌──────────────────┐  │
 │  │  Admin    │  │ Analysis  │  │Histograms│  │ Efficient        │  │
 │  │  Pages    │  │ Dashboard │  │ Detail   │  │ Frontier         │  │
 │  │          │  │           │  │          │  │                  │  │
 │  │ Upload   │  │ Framework │  │ Chart.js │  │ Scatter Chart    │  │
 │  │ Classify │  │ Selection │  │ Overlays │  │ Pareto Frontier  │  │
 │  │ Build    │  │ Top-5     │  │          │  │                  │  │
 │  │ Summary  │  │ Table     │  │          │  │                  │  │
 │  └────┬─────┘  └─────┬─────┘  └────┬─────┘  └────────┬─────────┘  │
 │       │              │              │                  │            │
 │  ┌────┴──────────────┴──────────────┴──────────────────┴────────┐  │
 │  │              AppContext (Global State)                        │  │
 │  │  framework | precalcData | ranked | frameworkConfig           │  │
 │  │  Client-side ranking (ranking.ts) — instant filtering        │  │
 │  └──────────────────────────┬───────────────────────────────────┘  │
 └─────────────────────────────┼───────────────────────────────────────┘
                               │ HTTP (JSON)
                               ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │                     BACKEND (FastAPI + Python)                      │
 │                                                                     │
 │  ┌──────────────┐  ┌────────────────┐  ┌────────────────────────┐  │
 │  │  main.py     │  │ calculations.py│  │  portfolios_db.json    │  │
 │  │              │  │                │  │                        │  │
 │  │ 25+ REST     │  │ Monte Carlo    │  │ Fingerprint-keyed      │  │
 │  │ endpoints    │  │ engine         │  │ persistence:           │  │
 │  │              │  │                │  │ - note classifications │  │
 │  │ Session      │  │ Metrics        │  │ - asset metadata       │  │
 │  │ management   │  │ computation    │  │ - portfolio weights    │  │
 │  │              │  │                │  │ - framework config     │  │
 │  │ Pre-calc     │  │ Scoring &      │  │                        │  │
 │  │ pipeline     │  │ ranking        │  │                        │  │
 │  └──────────────┘  └────────────────┘  └────────────────────────┘  │
 │                                                                     │
 │  In-memory: SESSION dict holds DataFrame, precalc results,          │
 │  sim_data (NumPy float32 array: n_sims x n_periods x n_cols)       │
 └─────────────────────────────────────────────────────────────────────┘
```

---

## 2. End-to-End Workflow

```
                    ┌─────────────────┐
                    │   User uploads  │
                    │   .xlsx file    │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Parse & Detect │──── Validate: >=4 assets, >=1 note
                    │  columns        │──── Detect Tracking sheet (auto-classify)
                    │  Fingerprint    │──── Restore saved state if fingerprint matches
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Classify Notes │
                    │                 │──── User assigns type + yield per note
                    │  Types: Income  │──── Income/MLCD/PPN require yield_pct
                    │  Growth/Digital │
                    │  Absolute/MLCD  │
                    │  PPN/Snowball   │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Asset Metadata │
                    │                 │──── User assigns yield + bucket per asset
                    │  Buckets:       │──── Equity | Fixed Income | Alternative | Cash
                    │  Equity/FI/     │
                    │  Alt/Cash       │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  Build          │
                    │  Portfolios     │──── Name, select assets, set weights (sum=100%)
                    │                 │──── Multiple portfolios supported
                    └────────┬────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  PRE-CALCULATION              │
              │  (triggered on portfolio save)│
              │                              │
              │  For each portfolio:          │
              │    For each horizon (1,2,3):  │
              │      Compute base metrics    │
              │      For each outlook (3):   │
              │        For each note:        │
              │          For alloc 5%..40%:  │
              │            Rebalance         │
              │            Compute metrics   │
              │            Check acceptance  │
              │            Store if passes   │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  ANALYSIS DASHBOARD           │
              │                              │
              │  User selects:               │
              │  ┌─────────┐ ┌────────────┐  │
              │  │Portfolio │ │ Outlook    │  │
              │  └─────────┘ │ Risk Tol.  │  │
              │              │ Goal       │  │
              │  ┌─────────┐ │ Horizon    │  │
              │  │Min/Max  │ └────────────┘  │
              │  │Alloc %  │                 │
              │  └─────────┘                 │
              └──────────────┬───────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │  CLIENT-SIDE FILTERING        │
              │  (instant, no server call)    │
              │                              │
              │  1. Lookup 27-cell config    │
              │  2. Filter by alloc range    │
              │  3. Filter by cell rules     │
              │  4. Score candidates         │
              │  5. Deduplicate by note_id   │
              │  6. Return top 5             │
              └──────────────┬───────────────┘
                             │
                     ┌───────┴────────┐
                     ▼                ▼
           ┌──────────────┐  ┌──────────────────┐
           │  Histogram   │  │ Efficient        │
           │  Detail      │  │ Frontier         │
           │              │  │                  │
           │  Server call │  │ Server call      │
           │  Re-compute  │  │ All candidates   │
           │  returns for │  │ Mean vs Std      │
           │  top-5 only  │  │ Pareto frontier  │
           └──────────────┘  └──────────────────┘
```

---

## 3. Input Specification

### 3.1 Excel File Structure

```
┌────────────┬────────┬───────────┬───────────┬─────┬──────────────────┬──────────────────┐
│ Simulation │ Period │ US Large  │ US Small  │ ... │ ('Note','65432') │ ('Note','78901') │
│            │        │ Cap       │ Cap       │     │                  │                  │
├────────────┼────────┼───────────┼───────────┼─────┼──────────────────┼──────────────────┤
│     1      │   0    │  0.0723   │  0.0891   │     │     0.0500       │    -0.0312       │
│     1      │   1    │ -0.0234   │  0.0156   │     │     0.0500       │     0.0800       │
│     1      │   2    │  0.1045   │  0.0678   │     │    -0.1200       │     0.0500       │
│     2      │   0    │  0.0512   │ -0.0345   │     │     0.0500       │     0.0623       │
│    ...     │  ...   │   ...     │   ...     │     │      ...         │      ...         │
└────────────┴────────┴───────────┴───────────┴─────┴──────────────────┴──────────────────┘

Typical size: 10,000 simulations x 3 periods = 30,000 rows
              14 asset columns + 5 note columns = 19 data columns

All return values are FRACTIONS (0.07 = 7%)
```

### 3.2 Optional Tracking Sheet

```
┌─────────┬───────────┬────────────┬───────────┬─────────────────┬──────────────┐
│ NoteId  │ Note Type │ Quote Used │ Underlier │ Protection Type │ Protection % │
├─────────┼───────────┼────────────┼───────────┼─────────────────┼──────────────┤
│ 65432   │ Income    │ 5.0        │ SPX       │ Hard            │ 30.0         │
│ 78901   │ Growth    │            │ RUT       │ Soft            │ 20.0         │
└─────────┴───────────┴────────────┴───────────┴─────────────────┴──────────────┘
```

### 3.3 User Inputs (by stage)

| Stage | Input | Values | Required |
|-------|-------|--------|----------|
| Classify Notes | Note type | Income, Growth, Digital, Absolute, MLCD, PPN, Snowball | Yes (all notes) |
| Classify Notes | Yield % | Float (e.g., 5.0 = 5% pa) | Only for Income/MLCD/PPN |
| Asset Metadata | Annual yield % | Float per asset | Yes (all assets) |
| Asset Metadata | Economic bucket | Equity, Fixed Income, Alternative, Cash | Yes (all assets) |
| Portfolio Builder | Portfolio name | String | Yes |
| Portfolio Builder | Asset weights | % per asset, must sum to 100 | Yes |
| Analysis | Market Outlook | Bearish, Neutral, Bullish | Yes |
| Analysis | Risk Tolerance | Conservative, Moderate, Aggressive | Yes |
| Analysis | Portfolio Goal | Growth, Balanced, Income | Yes |
| Analysis | Horizon | 1, 2, or 3 years | Yes |
| Analysis | Min/Max Allocation | 5%–40% range | Yes (defaults: 5%–30%) |

---

## 4. Data Pipeline

```
 RAW EXCEL                PARSED                    CUMULATIVE              PORTFOLIO
 (30k rows)               (NumPy array)             RETURNS                 RETURNS

 ┌──────────┐   parse    ┌──────────────┐  compound ┌──────────────┐  dot  ┌──────────┐
 │ Sim  Per │ ────────►  │  float32     │ ───────►  │  float64     │ ───►  │ float64  │
 │  1    0  │            │  (10000,     │           │  (10000,     │       │ (10000,) │
 │  1    1  │            │   3,         │           │   19)        │       │          │
 │  1    2  │            │   19)        │           │              │       │ One val  │
 │  2    0  │            │              │           │ One row per  │       │ per sim  │
 │  ...     │            │ n_sims x     │           │ simulation   │       │          │
 │          │            │ n_periods x  │           │              │       │          │
 └──────────┘            │ n_cols       │           │ Per-sim      │       │ Weighted │
                         └──────────────┘           │ compounded   │       │ sum of   │
                                                    │ return       │       │ assets   │
                                                    └──────────────┘       └──────────┘
                                                                                │
                                                                                ▼
                                                                          ┌──────────┐
                                                                          │ METRICS  │
                                                                          │          │
                                                                          │ mean     │
                                                                          │ std      │
                                                                          │ sharpe   │
                                                                          │ pct_neg  │
                                                                          │ shorty   │
                                                                          │ d_kurt   │
                                                                          │ income   │
                                                                          └──────────┘
```

### 4.1 Cumulative Return Computation

For each simulation and each column, over the selected horizon:

```
cumulative_return = (1 + r_0) x (1 + r_1) x ... x (1 + r_{h-1})  -  1
```

**Worked example (3-year horizon, one asset):**
```
Period 0:  r = +0.05   -->  factor = 1.05
Period 1:  r = -0.02   -->  factor = 1.05 x 0.98 = 1.029
Period 2:  r = +0.08   -->  factor = 1.029 x 1.08 = 1.11132

Cumulative return = 1.11132 - 1 = 0.11132  (11.1%)
```

### 4.2 Portfolio Return Vector

```
portfolio_return[sim] = SUM( weight[a] x cumulative_return[a, sim] )
                         for all assets a

Implemented as:  cum_df[asset_cols].values  @  weights_vector
```

---

## 5. Calculation Engine

### 5.1 Annualization

All metrics use annualized returns for cross-horizon comparability:

```
annualized_return[sim] = (1 + cumulative_return[sim]) ^ (1 / horizon) - 1
```

For horizon=1 this is a no-op. For horizon=3, it extracts the equivalent per-year return.

### 5.2 Metrics Computed

| Metric | Formula | Direction | Annualized? | Units |
|--------|---------|-----------|-------------|-------|
| **Mean** | `mean(annualized_returns)` | Higher = better | Yes | Fraction |
| **Std** | `std(annualized_returns, ddof=1)` | Lower = better | Yes | Fraction |
| **Sharpe** | `(mean - rfr) / std` | Higher = better | Yes | Dimensionless |
| **% Negative** | `100 x count(cum_r < 0) / n_sims` | Lower = better | No (raw cumulative) | Percentage points |
| **Shorty** | `kurtosis(cum_returns, fisher=True)` | Lower = better | No (raw cumulative) | Dimensionless |
| **Downside Kurt.** | `kurtosis(cum_returns[<0], fisher=True)` | Lower = better | No (raw cumulative) | Dimensionless |
| **Exp. Income** | `SUM(weight[a] x yield[a])` | Higher = better | N/A | Percentage points |

**Sharpe ratio detail:**
```
risk_free_rate input: annual % (e.g., 2.0 = 2%)
rfr = risk_free_rate / 100.0

sharpe = (mean - rfr) / std       if std > 0
sharpe = 0.0                      if std <= 0
```

**Downside kurtosis guard:**
```
downside = cumulative_returns[cumulative_returns < 0]
if len(downside) > 30:
    downside_kurt = kurtosis(downside, fisher=True)
else:
    downside_kurt = 0.0     # Too few samples for stable estimate
```

### 5.3 Expected Income

```
expected_income_pct = SUM( weight[a] x annual_yield_pct[a] )

where:
  weight[a]           = fraction (0.0 - 1.0)
  annual_yield_pct[a] = percentage (e.g., 2.0 = 2%)
  result              = percentage points (e.g., 1.8 = 1.8% pa)
```

Only income-category notes contribute yield: **Income, MLCD, PPN**.
Growth, Digital, Absolute, Snowball contribute 0 to expected income.

---

## 6. Framework Constraint System (27-Cell Grid)

The framework is a configurable **3 x 3 x 3 grid** that controls which notes are eligible for each market scenario.

### 6.1 Grid Structure

```
                          GOAL
                Growth    Balanced    Income
              ┌──────────┬──────────┬──────────┐
 BULLISH      │          │          │          │
              │ Cons.    │ Cons.    │ Cons.    │
  Outlook     │ Mod.     │ Mod.     │ Mod.     │   RISK
              │ Aggr.    │ Aggr.    │ Aggr.    │   TOLERANCE
              ├──────────┼──────────┼──────────┤
 NEUTRAL      │          │          │          │
              │ Cons.    │ Cons.    │ Cons.    │
  Outlook     │ Mod.     │ Mod.     │ Mod.     │
              │ Aggr.    │ Aggr.    │ Aggr.    │
              ├──────────┼──────────┼──────────┤
 BEARISH      │          │          │          │
              │ Cons.    │ Cons.    │ Cons.    │
  Outlook     │ Mod.     │ Mod.     │ Mod.     │
              │ Aggr.    │ Aggr.    │ Aggr.    │
              └──────────┴──────────┴──────────┘

Cell key format: "{Outlook}|{Risk}|{Goal}"
Example: "Bullish|Moderate|Growth"
Total cells: 3 x 3 x 3 = 27
```

### 6.2 Cell Parameters

Each of the 27 cells contains:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `allowed_types` | string[] | (varies by outlook) | Note types eligible. Empty = all. |
| `allowed_underlyings` | string[] | [] | Allowed underliers (e.g., SPX, RUT). Empty = no filter. |
| `allowed_protection_types` | string[] | [] | Allowed protection types (e.g., Hard, Soft). Empty = no filter. |
| `min_protection_pct` | float | 0.0 | Minimum protection % required. |
| `max_protection_pct` | float | 100.0 | Maximum protection % allowed. |
| `max_alloc_pct` | float | 30.0 | Maximum note allocation as %. |

### 6.3 Default Allowed Types by Outlook

```
┌───────────┬──────────────────────────────────────────────────────┐
│ Outlook   │ Default allowed_types                                │
├───────────┼──────────────────────────────────────────────────────┤
│ Bullish   │ Growth, Digital, Absolute, Snowball                  │
│ Neutral   │ Growth, Digital, Absolute, Snowball, Income, MLCD,   │
│           │ PPN                                                  │
│ Bearish   │ Income, MLCD, PPN, Absolute, Snowball                │
└───────────┴──────────────────────────────────────────────────────┘
```

### 6.4 Outlook Buckets (which assets are reduced to make room for notes)

```
┌───────────┬───────────────────────────────────────────┐
│ Outlook   │ Asset buckets reduced on note addition     │
├───────────┼───────────────────────────────────────────┤
│ Bullish   │ Equity only                                │
│ Neutral   │ Equity, Fixed Income, Alternative, Cash    │
│ Bearish   │ Equity, Fixed Income                       │
└───────────┴───────────────────────────────────────────┘
```

### 6.5 Framework Decision Tree

```
User selects: Outlook=Bearish, Risk=Moderate, Goal=Income
                              │
                              ▼
              ┌───────────────────────────────┐
              │ Cell key: "Bearish|Moderate|   │
              │            Income"             │
              └───────────────┬───────────────┘
                              │
              ┌───────────────┴───────────────────────────┐
              │                                           │
              ▼                                           ▼
    ┌──────────────────┐                      ┌──────────────────────┐
    │ Outlook Buckets  │                      │ Cell Config          │
    │                  │                      │                      │
    │ Bearish:         │                      │ allowed_types:       │
    │ [Equity,         │                      │  [Income, MLCD, PPN, │
    │  Fixed Income]   │                      │   Absolute, Snowball]│
    │                  │                      │ max_alloc_pct: 30%   │
    │ These assets are │                      │ min_protection: 0%   │
    │ reduced pro-rata │                      │ max_protection: 100% │
    │ to make room for │                      │                      │
    │ the note         │                      │ These rules filter   │
    │                  │                      │ which candidates     │
    └──────────────────┘                      │ are eligible         │
                                              └──────────────────────┘
```

---

## 7. Two-Phase Candidate Processing

### 7.1 Overview

```
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  PHASE 1: PRE-CALCULATION (runs once per portfolio save)              │
│                                                                       │
│  Input: Portfolio weights, all notes, all outlooks, horizons 1-3      │
│                                                                       │
│  ┌─────────────┐                                                      │
│  │ For each    │                                                      │
│  │ portfolio   │──►  For each horizon (1, 2, 3):                      │
│  └─────────────┘       │                                              │
│                        ├──  Compute base metrics                      │
│                        │                                              │
│                        └──  For each outlook (Bullish, Neutral,       │
│                              Bearish):                                │
│                               │                                       │
│                               └──  For each note:                     │
│                                      │                                │
│                                      └──  For alloc = 5%, 10%,       │
│                                            15%, ..., 40%:            │
│                                             │                         │
│                                             ├── Rebalance weights     │
│                                             ├── Compute metrics       │
│                                             ├── Check acceptance      │
│                                             └── Store if accepted     │
│                                                                       │
│  Output: Metrics-only candidates (NO full return arrays)              │
│  Storage: SESSION["precalc"][portfolio_name]                          │
│                                                                       │
│  Typical volume: 5 notes x 8 allocs x 3 outlooks x 3 horizons       │
│                = 360 candidate evaluations per portfolio               │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
                              │
                              │  Pre-computed data available
                              ▼
┌───────────────────────────────────────────────────────────────────────┐
│                                                                       │
│  PHASE 2: FRAMEWORK FILTERING (runs on demand, instant)               │
│                                                                       │
│  Input: Pre-computed candidates + user's framework selection          │
│                                                                       │
│  ┌─────────────────┐                                                  │
│  │ User selects    │                                                  │
│  │ Outlook, Risk,  │──►  Look up 27-cell config                      │
│  │ Goal, Horizon   │       │                                          │
│  └─────────────────┘       │                                          │
│                            ├──  Filter by max_alloc_pct               │
│                            ├──  Filter by allowed_types               │
│                            ├──  Filter by allowed_underlyings         │
│                            ├──  Filter by allowed_protection_types    │
│                            ├──  Filter by protection_pct range        │
│                            ├──  Score remaining candidates            │
│                            ├──  Deduplicate by note_id                │
│                            └──  Return top 5                          │
│                                                                       │
│  Output: Top 5 candidates with scores                                 │
│                                                                       │
│  CLIENT-SIDE: ranking.ts does this instantly (no server call)         │
│  SERVER-SIDE: /find-improvements does same + re-computes full         │
│               return arrays for top-5 (needed for histograms)         │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### 7.2 Pre-Calc Storage Structure

```
SESSION["precalc"]["60-40 Balanced"] = {
    "_base": {
        "1": { sharpe, pct_neg, shorty, downside_kurt, mean, std, expected_income_pct },
        "2": { ... },
        "3": { ... }
    },
    "Bullish": {
        "1": [
            {
                note_id:         "65432",
                note_type:       "Income",
                alloc_pct:       0.10,           // fraction, NOT percentage
                underlier:       "SPX",
                protection_type: "Hard",
                protection_pct:  30.0,
                metrics: {
                    sharpe:        0.4521,
                    pct_neg:       11.2,
                    shorty:        1.34,
                    downside_kurt: 2.1,
                    mean:          0.068,
                    std:           0.142,
                    income_boost:  0.5
                }
            },
            ...more candidates
        ],
        "2": [...],
        "3": [...]
    },
    "Neutral":  { "1": [...], "2": [...], "3": [...] },
    "Bearish":  { "1": [...], "2": [...], "3": [...] }
}
```

---

## 8. Rebalancing Logic

When adding a note at allocation fraction `alloc`, bucket assets are reduced **pro-rata** to make room. Non-bucket assets are unchanged.

### 8.1 Algorithm

```
Step 1: Identify bucket assets
    bucket_assets = assets where asset_bucket IN allowed_buckets_for_outlook

Step 2: Compute bucket total
    bucket_total = SUM( base_weight[a] for a in bucket_assets )

Step 3: Reduce each bucket asset proportionally
    For each asset a in bucket_assets:
        new_weight[a] = base_weight[a] - (base_weight[a] / bucket_total) x alloc

Step 4: Non-bucket assets keep original weights
    For each asset a NOT in bucket_assets:
        new_weight[a] = base_weight[a]

Step 5: Compute new portfolio return
    port_return[sim] = SUM( new_weight[a] x cum_return[a, sim] )
                     + alloc x cum_return[note, sim]
```

### 8.2 Worked Example

```
Portfolio: "60-40 Balanced"
Outlook: Bearish (buckets: Equity, Fixed Income)

Base weights:
  US Large Cap       0.30   (Equity)      ─┐
  US Small Cap       0.10   (Equity)       ├── bucket_total = 0.60
  US Bonds           0.20   (Fixed Income) ─┘
  Gold               0.15   (Alternative)  ── not in bucket, unchanged
  Cash               0.10   (Cash)         ── not in bucket, unchanged
  Int'l Equity       0.15   (Equity)      ─── in bucket (part of 0.60)

Wait, let me recalculate: 0.30 + 0.10 + 0.20 + 0.15 = 0.75...
Let me use a cleaner example:

Base weights:
  US Large Cap       0.30   (Equity)      ─┐
  US Small Cap       0.10   (Equity)       ├── bucket_total = 0.60
  US Bonds           0.20   (Fixed Income) ─┘
  Gold               0.15   (Alternative)  ── unchanged
  Cash               0.25   (Cash)         ── unchanged
                     ────
                     1.00

Adding note at alloc = 0.10 (10%):

  US Large Cap:   0.30 - (0.30/0.60) x 0.10 = 0.30 - 0.050 = 0.250
  US Small Cap:   0.10 - (0.10/0.60) x 0.10 = 0.10 - 0.017 = 0.083
  US Bonds:       0.20 - (0.20/0.60) x 0.10 = 0.20 - 0.033 = 0.167
  Gold:           0.15                                        = 0.150  (unchanged)
  Cash:           0.25                                        = 0.250  (unchanged)
  Note:                                                       = 0.100
                                                               ─────
                                                               1.000  (verified)

Within the bucket, relative proportions are preserved:
  US Large Cap was 50% of bucket (0.30/0.60), still 50% (0.250/0.500)
  US Small Cap was 16.7%, still 16.7% (0.083/0.500)
  US Bonds was 33.3%, still 33.3% (0.167/0.500)
```

### 8.3 Edge Cases

```
If alloc > bucket_total:
    SKIP this allocation (cannot reduce bucket below 0)

If bucket_total = 0:
    SKIP this note entirely for this outlook (no assets to reduce)
```

---

## 9. Filtering Pipeline

The system applies filters at two stages. Here is every filter in order:

### 9.1 Phase 1 Filters (Pre-Calculation)

```
ALL POSSIBLE CANDIDATES
(5 notes x 8 alloc levels x 3 outlooks x 3 horizons = 360)
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER P1: Bucket Assets      │  Does this outlook have assets
    │            Exist              │  in the allowed bucket?
    │                               │
    │ If bucket_total <= 0: SKIP    │  Removes: notes where outlook
    │ entire note for this outlook  │  has no valid bucket assets
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER P2: Allocation Cap     │  Can the bucket absorb this
    │                               │  allocation level?
    │ If alloc > bucket_total:      │
    │ SKIP this allocation level    │  Removes: 30% alloc when bucket
    │                               │  only has 25% total weight
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER P3: Acceptance         │  Does the candidate improve
    │            Criteria           │  ANY metric?
    │                               │
    │ Must satisfy at least ONE:    │  Removes: candidates that are
    │ - Better Sharpe               │  strictly worse on all metrics
    │ - Lower % Negative            │
    │ - Lower Shorty                │  (See Section 10 for detail)
    │ - Lower Downside Kurt         │
    │ - Income boost (if income     │
    │   note type)                  │
    └───────────────┬───────────────┘
                    │
                    ▼
           STORED CANDIDATES
    (metrics only, no return arrays)
```

### 9.2 Phase 2 Filters (On-Demand Framework Filtering)

```
STORED CANDIDATES for selected outlook + horizon
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER F1: Allocation Range   │  Client: minAlloc <= alloc <= maxAlloc
    │                               │  Server: alloc <= cell.max_alloc_pct
    │ User sets min/max in UI       │
    │ Cell config sets max_alloc    │  Removes: candidates outside the
    │                               │  user's desired allocation band
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER F2: Note Type          │  Is this note type allowed in
    │            Whitelist          │  this cell?
    │                               │
    │ If cell.allowed_types is      │  Removes: e.g., Growth notes
    │ non-empty AND note_type       │  when cell only allows Income
    │ NOT in list: SKIP             │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER F3: Underlier          │  Is this note's underlier
    │            Whitelist          │  allowed?
    │                               │
    │ If cell.allowed_underlyings   │  Removes: e.g., RUT-linked
    │ is non-empty AND underlier    │  notes when cell only allows SPX
    │ NOT in list: SKIP             │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER F4: Protection Type    │  Is this note's protection type
    │            Whitelist          │  allowed?
    │                               │
    │ If cell.allowed_protection    │  Removes: Soft-protected notes
    │ _types is non-empty AND       │  when cell requires Hard
    │ protection_type NOT in        │
    │ list: SKIP                    │
    └───────────────┬───────────────┘
                    │
                    ▼
    ┌───────────────────────────────┐
    │ FILTER F5: Protection %       │  Is the note's protection level
    │            Range              │  within bounds?
    │                               │
    │ If protection_pct <           │  Removes: 10% protected notes
    │    cell.min_protection_pct    │  when cell requires min 20%
    │ OR protection_pct >           │
    │    cell.max_protection_pct:   │
    │ SKIP                          │
    └───────────────┬───────────────┘
                    │
                    ▼
           FILTERED CANDIDATES
        (proceed to scoring)
```

### 9.3 Combined Filter Summary

```
┌────────────────────────────────────────────────────────────────────┐
│                     COMPLETE FILTER FUNNEL                          │
│                                                                    │
│  360 potential candidates (5 notes x 8 allocs x 3 outlooks x 3h)  │
│                          │                                         │
│                     [P1: Bucket exists]                             │
│                          │                                         │
│                     [P2: Alloc fits bucket]                         │
│                          │                                         │
│                     [P3: At least 1 metric improves]               │
│                          │                                         │
│              ~50-150 stored candidates (typical)                    │
│                          │                                         │
│        Select outlook + horizon subset (~15-50)                    │
│                          │                                         │
│                     [F1: Alloc range / max_alloc]                  │
│                          │                                         │
│                     [F2: Note type whitelist]                       │
│                          │                                         │
│                     [F3: Underlier whitelist]                       │
│                          │                                         │
│                     [F4: Protection type whitelist]                 │
│                          │                                         │
│                     [F5: Protection % range]                       │
│                          │                                         │
│              ~5-20 scored candidates                               │
│                          │                                         │
│                     [Score, sort, deduplicate]                      │
│                          │                                         │
│                   TOP 5 UNIQUE NOTES                               │
└────────────────────────────────────────────────────────────────────┘
```

---

## 10. Acceptance Criteria

A candidate passes if it improves on **at least one** dimension (OR logic):

```
                    ┌──────────────────┐
                    │  Evaluate        │
                    │  Candidate       │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
         ┌─────────┐   ┌─────────┐   ┌──────────┐
         │ Sharpe   │   │ % Neg   │   │ Shorty   │
         │ >=base?  │   │ <=base? │   │ <=base?  │
         └────┬─────┘   └────┬────┘   └────┬─────┘
              │              │              │
     ┌────┐  │     ┌────┐   │     ┌────┐   │
     │YES │──┘     │YES │───┘     │YES │───┘
     └──┬─┘        └──┬─┘         └──┬─┘
        │              │              │
        │    ┌─────────┴─────────┐    │
        │    ▼                   ▼    │
        │  ┌──────────┐  ┌──────────┐ │
        │  │ Down.Kurt│  │ Income   │ │
        │  │ <=base?  │  │ boost>0? │ │
        │  └────┬─────┘  │(income   │ │
        │       │        │ type     │ │
        │  ┌────┘        │ only)    │ │
        │  │YES          └────┬────┘  │
        │  │             ┌────┘       │
        │  │             │YES         │
        ▼  ▼             ▼            ▼
    ┌──────────────────────────────────────┐
    │            ANY YES?                   │
    │                                      │
    │  YES ──► ACCEPT candidate            │
    │  NO  ──► REJECT candidate            │
    └──────────────────────────────────────┘
```

**In code:**
```
accepted = (
    new_sharpe        >= base_sharpe        OR
    new_pct_neg       <= base_pct_neg       OR
    new_shorty        <= base_shorty        OR
    new_downside_kurt <= base_downside_kurt OR
    (note_type IN {Income, MLCD, PPN} AND income_boost > 0)
)
```

---

## 11. Scoring & Ranking

### 11.1 Scoring Formula

```
score = w_sharpe   x (candidate_sharpe        - base_sharpe)
      - w_neg      x (candidate_pct_neg       - base_pct_neg)
      - w_shorty   x (candidate_shorty        - base_shorty)
      - w_downside x (candidate_downside_kurt - base_downside_kurt)
      + w_income   x income_boost
```

### 11.2 Weight Table

| Term | Weight | Sign | Rationale |
|------|--------|------|-----------|
| Delta Sharpe | **1.0** | + (reward increase) | Risk-adjusted return is primary |
| Delta % Negative | **1.0** | - (penalise increase) | Downside protection equally important |
| Delta Shorty | **0.5** | - (penalise increase) | Tail risk, half weight of mean metrics |
| Delta Downside Kurt. | **0.5** | - (penalise increase) | Left-tail cliff risk from barriers |
| Income Boost | **goal-dependent** | + (always positive) | Yield improvement |

### 11.3 Goal-Dependent Income Weight

```
┌───────────┬─────────────┬──────────────────────────────────────┐
│ Goal      │ w_income    │ Effect                               │
├───────────┼─────────────┼──────────────────────────────────────┤
│ Income    │ 0.5         │ Yield heavily influences ranking     │
│ Balanced  │ 0.1         │ Small yield influence                │
│ Growth    │ 0.0         │ Yield completely ignored             │
└───────────┴─────────────┴──────────────────────────────────────┘
```

### 11.4 Worked Scoring Example

```
Base portfolio metrics:
  sharpe = 0.4200, pct_neg = 15.0%, shorty = 1.50, downside_kurt = 2.00
  expected_income = 1.80%

Candidate (Note 65432, Income type, 10% allocation):
  sharpe = 0.4500, pct_neg = 13.5%, shorty = 1.60, downside_kurt = 1.90
  income_boost = 0.50%

Goal = Income (w_income = 0.5):

score = 1.0 x (0.4500 - 0.4200)        =  +0.0300   (Sharpe improved)
      - 1.0 x (13.5   - 15.0  )        =  +1.5000   (% Neg improved by 1.5pp)
      - 0.5 x (1.60   - 1.50  )        =  -0.0500   (Shorty worsened)
      - 0.5 x (1.90   - 2.00  )        =  +0.0500   (Downside Kurt improved)
      + 0.5 x 0.50                      =  +0.2500   (Income boost)
                                          ─────────
                                    TOTAL = +1.7800

Same candidate with Goal = Growth (w_income = 0.0):

score = +0.0300 + 1.5000 - 0.0500 + 0.0500 + 0.0
                                    TOTAL = +1.5300   (lower, no income credit)
```

### 11.5 Sign Convention Summary

```
Metric improves     →  Delta is  →  Contribution to score
─────────────────────────────────────────────────────────
Sharpe goes UP      →  positive  →  POSITIVE  (good)
% Negative goes DOWN→  negative  →  POSITIVE  (good, double negative)
Shorty goes DOWN    →  negative  →  POSITIVE  (good, double negative)
D.Kurt goes DOWN    →  negative  →  POSITIVE  (good, double negative)
Income boost > 0    →  positive  →  POSITIVE  (good)
```

---

## 12. Deduplication & Top-5 Selection

### 12.1 Algorithm

```
┌─────────────────────────────────┐
│ All scored candidates           │
│ (may have same note at          │
│  multiple allocations)          │
│                                 │
│ Example:                        │
│  Note 65432 @ 10% → score 1.78 │
│  Note 65432 @ 15% → score 1.65 │
│  Note 78901 @ 5%  → score 1.50 │
│  Note 65432 @ 20% → score 1.42 │
│  Note 78901 @ 10% → score 1.38 │
│  Note 34567 @ 10% → score 1.20 │
│  Note 12345 @ 15% → score 1.10 │
│  Note 99999 @ 5%  → score 0.95 │
│  Note 12345 @ 10% → score 0.90 │
└────────────────┬────────────────┘
                 │
                 │  1. Sort by score DESC
                 │  2. Walk list, track seen note_ids
                 │  3. Keep first occurrence of each note_id
                 │  4. Stop at 5 unique notes
                 ▼
┌─────────────────────────────────┐
│ Result (top 5 unique notes):    │
│                                 │
│  #1  Note 65432 @ 10% → 1.78   │  (best alloc for 65432)
│  #2  Note 78901 @ 5%  → 1.50   │  (best alloc for 78901)
│  #3  Note 34567 @ 10% → 1.20   │  (only alloc for 34567)
│  #4  Note 12345 @ 15% → 1.10   │  (best alloc for 12345)
│  #5  Note 99999 @ 5%  → 0.95   │  (only alloc for 99999)
│                                 │
│  Skipped:                       │
│  Note 65432 @ 15% (duplicate)   │
│  Note 65432 @ 20% (duplicate)   │
│  Note 78901 @ 10% (duplicate)   │
│  Note 12345 @ 10% (duplicate)   │
└─────────────────────────────────┘
```

### 12.2 ensure_note_id (Server-Side Only)

When navigating to a histogram detail, the frontend passes a `note_id` parameter. The server inserts that note's best-scoring candidate first before deduplication, guaranteeing it appears in the top 5 even if it wouldn't normally rank that high.

---

## 13. Output Specification

### 13.1 Per-Candidate Output

| Field | Type | Units | Example |
|-------|------|-------|---------|
| `note_id` | string | | "65432" |
| `note_type` | string | | "Income" |
| `alloc_pct` | float | fraction | 0.10 (= 10%) |
| `sharpe` | float | dimensionless | 0.4500 |
| `pct_neg` | float | percentage points | 13.5 |
| `mean` | float | fraction (annualized) | 0.068 |
| `std` | float | fraction (annualized) | 0.142 |
| `shorty` | float | dimensionless | 1.60 |
| `downside_kurt` | float | dimensionless | 1.90 |
| `income_boost` | float | percentage points | 0.50 |
| `score` | float | dimensionless | 1.78 |

### 13.2 Histogram Data

For each top-5 candidate, the server generates an overlay histogram:
- **Base distribution:** 10,000 cumulative portfolio returns, 80 bins, probability density
- **Candidate distribution:** 10,000 cumulative returns with note added, 80 bins, probability density
- Rendered as Chart.js mixed bar + smoothed line overlay

### 13.3 Efficient Frontier

Three datasets at horizon=2 for a selected outlook:
- **Base points:** (mean, std) per saved portfolio
- **Candidate cloud:** (mean, std) for every (portfolio x note x alloc) that passed acceptance
- **Pareto frontier:** upper-left boundary of candidate cloud (sort by std ASC, keep only points where mean > all previous)

### 13.4 Exports

| Format | Content |
|--------|---------|
| CSV | Top-5 candidates with all metrics and deltas |
| PDF | Full report: base metrics, top-5 table, overlay histograms (as PNGs) |

---

## 14. Constants & Reference Tables

### 14.1 Note Type Categories

```
NOTE_TYPES_GROWTH  = { Growth, Digital, Absolute, Snowball }
NOTE_TYPES_INCOME  = { Income, MLCD, PPN }

Income-eligible notes contribute yield to expected income calculation.
Growth-category notes contribute 0 to expected income.
```

### 14.2 Allocation Steps

```
Pre-calculation:  5%, 10%, 15%, 20%, 25%, 30%, 35%, 40%  (global max)
Framework cell:   max_alloc_pct default = 30% (configurable per cell)
UI range:         min 5% to max 40% (user adjustable)
```

### 14.3 Scoring Weights

```
w_sharpe   = 1.0   (positive: reward higher Sharpe)
w_neg      = 1.0   (negative: penalise higher % Negative)
w_shorty   = 0.5   (negative: penalise higher kurtosis)
w_downside = 0.5   (negative: penalise higher downside kurtosis)
w_income   = 0.5   (Income goal)
           = 0.1   (Balanced goal)
           = 0.0   (Growth goal)
```

### 14.4 Asset Buckets

```
Equity          — stocks, equity ETFs
Fixed Income    — bonds, bond ETFs
Alternative     — commodities, real estate, hedge funds
Cash            — money market, T-bills
```

### 14.5 Units Reference

| Quantity | Stored As | Example |
|----------|----------|---------|
| Asset/note returns (DataFrame) | Fraction | 0.07 = 7% |
| Portfolio weights | Fraction | 0.40 = 40% |
| Asset annual yield | Percentage | 2.0 = 2% pa |
| Note annual yield | Percentage | 3.5 = 3.5% pa |
| Risk-free rate | Percentage | 2.0 = 2% pa |
| Mean return (metric) | Fraction (annualized) | 0.062 = 6.2% pa |
| Std (metric) | Fraction (annualized) | 0.12 = 12% pa |
| Sharpe ratio | Dimensionless (annualized) | 0.45 |
| % Negative | Percentage points | 12.3 = 12.3% of sims |
| Shorty | Dimensionless | 1.4 |
| Downside kurtosis | Dimensionless | 2.1 |
| Expected income | Percentage points | 1.8 = 1.8% pa |
| Income boost | Percentage points | 0.4 = adds 0.4% pa |
| alloc_pct (precalc storage) | Fraction | 0.10 = 10% |
| max_alloc_pct (framework cell) | Percentage | 30.0 = 30% |
