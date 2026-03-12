# Portfolio Note Allocation Tool

A Monte Carlo–based web application that helps financial advisors evaluate which structured notes (and at what allocation) would improve an existing asset portfolio's risk-adjusted statistics.

---

## Table of Contents
1. [What It Does](#what-it-does)
2. [Tech Stack](#tech-stack)
3. [Running Locally](#running-locally)
4. [Input File Format](#input-file-format)
5. [6-Step Workflow](#6-step-workflow)
6. [Session Persistence](#session-persistence)
7. [API Endpoints](#api-endpoints)
8. [Deployment](#deployment)

---

## What It Does

Given a Monte Carlo simulation file (thousands of simulated annual return paths for a set of asset classes and structured notes), the tool:

1. Parses and validates the simulation data
2. Lets the user classify each note (Income, Growth, Digital, etc.) and assign yields
3. Lets the user define one or more named asset portfolios with custom weights
4. Shows a statistical summary of each saved portfolio (Sharpe, % Negative, Shorty, Expected Income)
5. Lets the user select a market framework (Outlook × Risk Tolerance × Goal) and runs a base portfolio calculation
6. Searches all note × allocation combinations that pass the framework constraints, and surfaces the top 5 candidates ranked by a composite improvement score

Results can be exported as a CSV table or a full PDF report with embedded return-distribution histograms.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI + Uvicorn (Python 3.11) |
| Data processing | pandas, NumPy, SciPy |
| Visualisation | Plotly (histograms), Kaleido (PNG export) |
| PDF generation | ReportLab |
| Frontend | Next.js 16 + TypeScript + Tailwind CSS |
| Charts (UI) | react-plotly.js (dynamic import, client-side only) |

---

## Running Locally

### Prerequisites
- Python 3.11, virtualenv
- Node.js 18+

### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend
```bash
cd frontend
npm install
npm run dev                        # http://localhost:3000
```

### Environment Variables

**Frontend** (`frontend/.env.local`):
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```
This is baked into the Next.js bundle at build time. On Vercel, set it in **Project Settings → Environment Variables** before deploying.

**Backend** (optional):
```
CORS_ORIGINS=https://your-frontend-domain.vercel.app
```
Defaults to `*` (all origins) when unset.

### Dev Shortcut
Skip the browser file-picker during development:
```bash
curl -X POST http://localhost:8000/dev/load-test-file
```
This loads `Test2.xlsx` from the repo root directly into the session.

---

## Input File Format

The tool expects a `.xlsx` file with the following structure:

### Required Columns
| Column | Description |
|--------|-------------|
| `Simulation` | Integer simulation ID (1 … N) |
| `Period` | Integer period index (0-based; 0 = Year 1, 1 = Year 2, …) |
| *(asset columns)* | One column per asset class. Any name that is not a note column. Minimum 4 required. Values are period returns as fractions (e.g. `0.07` = 7%). |
| `('Note', 'ID')` | One column per structured note, named exactly `('Note', '123456')`. Values are period returns as fractions. Minimum 1 required. |

Column `Unnamed: 0` (pandas index export) is silently ignored.

### Sheet Detection
The tool looks for the data sheet by scanning (case-insensitive) for a sheet named `sheet1`, `data`, or `results`.

### Auto-Classification Sheet (optional)
If the file contains a sheet named `Tracking` or `Notes`, the tool reads:
- `NoteId` — matches against detected note column IDs
- `Note Type` — pre-populates the note type dropdown
- `Quote Used` — used as the expected annual yield (%) for Income-type notes

---

## 6-Step Workflow

### Step 1 — Upload
1. User drags & drops an `.xlsx` file (or clicks to browse)
2. Backend validates structure, detects asset and note columns
3. If the file fingerprint matches a previous session, saved portfolios and classifications are automatically restored
4. Returns: asset list, note list, row count, 10-row data preview, and any auto-classification suggestions

### Step 2 — Classify Notes
1. Each detected note is displayed with a type dropdown: `Income | Growth | Digital | Absolute | MLCD | PPN`
2. Notes auto-classified from the Tracking sheet show a blue **auto** badge
3. Income notes additionally require an expected annual yield (%)
4. All notes must be classified before proceeding
5. Classifications are saved to session and persisted to `portfolios_db.json`

### Step 3 — Portfolio Builder
**Asset Metadata**
- User assigns each asset class an expected annual yield (%) and an economic bucket: `Equity | Fixed Income | Alternative | Cash`

**Portfolio Creation**
- User names a portfolio, selects assets, and assigns weights via sliders (must sum to 100%)
- Multiple named portfolios can be saved; each persists across back-navigation and re-uploads of the same file

### Step 4 — Portfolio Summary
- Displays all saved portfolios as cards with configurable horizon (1 / 2 / 3 years) and risk-free rate
- Each card shows: Sharpe ratio, % Negative simulations, Shorty (excess kurtosis), Expected Income %, Mean Return, and a visual allocation breakdown
- Notes section lists all classified notes with type badges and yields
- See [CALCULATIONS.md](CALCULATIONS.md) for the full metric definitions

### Step 5 — Framework Selection & Base Calculation
User selects a market framework:
- **Market Outlook:** Bearish / Neutral / Bullish
- **Risk Tolerance:** Conservative / Moderate / Aggressive
- **Portfolio Goal:** Income / Balanced / Growth
- **Horizon:** 1 / 2 / 3 years
- **Risk-Free Rate:** % per annum
- **Starting Portfolio:** one of the saved portfolios

Clicking **Calculate** runs `POST /calculate-base`, which computes the full set of portfolio statistics for the selected portfolio under the chosen horizon and RFR.

### Step 6 — Improvements
Runs `POST /find-improvements` automatically on mount. The engine:
1. Filters notes by framework (Outlook × Risk Tolerance × Goal)
2. For each eligible note, tries every 5%-increment allocation up to the framework cap
3. Keeps only candidates that improve at least one metric vs the base
4. Ranks by composite score; deduplicates to one best allocation per note; returns top 5

Each row in the results table shows delta metrics vs the base. Users can expand any row to see an overlay histogram comparing return distributions. Export as CSV or PDF is available once results are loaded.

See [CALCULATIONS.md](CALCULATIONS.md) for the full mathematical detail.

---

## Session Persistence

The backend persists state to `backend/portfolios_db.json`, keyed by a 16-character MD5 fingerprint of the file's columns, first row, and row count.

**What persists across re-uploads of the same file:**
- Note classifications and yields
- Asset yields and bucket assignments
- All saved portfolio names and weights

**What does not persist:**
- The base calculation result (must re-run after upload)
- Improvement results (must re-run after upload)
- The simulation DataFrame itself (held only in memory)

**Session restore on page load:**
- `has_base = true` → jump directly to Step 6
- `portfolios saved AND asset buckets set` → jump to Step 4 (Portfolio Summary)
- `note_meta saved` → jump to Step 3 (Portfolio Builder)
- `file uploaded` → jump to Step 2 (Classify Notes)

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload` | Parse `.xlsx`, detect columns, restore persisted state |
| `POST` | `/classify-notes` | Save note type + yield classifications |
| `POST` | `/asset-metadata` | Save asset yields + bucket assignments |
| `POST` | `/portfolio/save` | Save a named portfolio with weights |
| `DELETE` | `/portfolio/{name}` | Delete a saved portfolio |
| `GET` | `/portfolios` | List all saved portfolios |
| `POST` | `/calculate-base` | Compute base portfolio statistics |
| `POST` | `/find-improvements` | Run improvement search, return top 5 |
| `GET` | `/portfolio-summary` | Stats for all portfolios (horizon + RFR params) |
| `GET` | `/histogram/{index}` | Plotly JSON for base vs candidate overlay |
| `GET` | `/export/csv` | Download improvements table as CSV |
| `GET` | `/export/pdf` | Download full report as PDF |
| `GET` | `/session-state` | Return full current session for frontend restore |
| `POST` | `/reset` | Clear in-memory session |
| `POST` | `/dev/load-test-file` | Dev only: load `Test2.xlsx` from disk |

---

## Deployment

### Backend — Render
- Service type: Web Service
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Root directory: `backend/`
- Python version: set in `/runtime.txt` at repo root (currently `3.11.9`)
- Set env var: `CORS_ORIGINS=https://your-vercel-domain.vercel.app`

### Frontend — Vercel
- Framework preset: Next.js
- Root directory: `frontend/`
- Set env var **before deploying**: `NEXT_PUBLIC_API_URL=https://your-render-backend.onrender.com`
  - This value is baked into the bundle at build time — changes require a redeploy

---

## Project Structure

```
portfolio/
├── backend/
│   ├── main.py              # FastAPI app, all endpoints, session management
│   ├── calculations.py      # Monte Carlo engine, metrics, improvement search
│   ├── requirements.txt
│   └── portfolios_db.json   # Persisted session state (auto-created)
├── frontend/
│   ├── app/page.tsx         # Step router, global state, session restore
│   ├── lib/api.ts           # All API calls; reads NEXT_PUBLIC_API_URL
│   └── components/
│       ├── StepNav.tsx
│       ├── Screen1Upload.tsx
│       ├── Screen2ClassifyNotes.tsx
│       ├── Screen3PortfolioBuilder.tsx
│       ├── Screen4PortfolioSummary.tsx
│       ├── Screen4Analysis.tsx
│       └── Screen5Improvements.tsx
├── runtime.txt              # Python version for Render
├── README.md                # This file
└── CALCULATIONS.md          # Mathematical methodology reference
```
