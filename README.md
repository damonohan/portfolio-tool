# Portfolio Note Allocation Tool

A Monte Carlo-based web application that helps financial advisors evaluate which structured notes (and at what allocation) would improve an existing asset portfolio's risk-adjusted statistics.

---

## Table of Contents
1. [What It Does](#what-it-does)
2. [Tech Stack](#tech-stack)
3. [Running Locally](#running-locally)
4. [Input File Format](#input-file-format)
5. [Application Workflow](#application-workflow)
6. [Session Persistence](#session-persistence)
7. [API Endpoints](#api-endpoints)
8. [Deployment](#deployment)
9. [Project Structure](#project-structure)

---

## What It Does

Given a Monte Carlo simulation file (thousands of simulated annual return paths for a set of asset classes and structured notes), the tool:

1. Parses and validates the simulation data
2. Lets the user classify each note (Income, Growth, Digital, etc.) and assign yields
3. Lets the user define one or more named asset portfolios with custom weights
4. Shows a statistical summary of each saved portfolio (Sharpe, % Negative, Shorty, Expected Income)
5. Lets the user select a market framework (Outlook x Risk Tolerance x Goal) and runs a base portfolio calculation
6. Searches all note x allocation combinations that pass the framework constraints, and surfaces the top 5 candidates ranked by a composite improvement score
7. Provides detailed histogram overlays comparing base vs candidate return distributions
8. Visualises the efficient frontier -- plotting risk vs return for all base portfolios and note-enhanced variants to identify optimal trade-offs

Results can be exported as a CSV table or a full PDF report with embedded return-distribution histograms.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI + Uvicorn (Python 3.11) |
| Data processing | pandas, NumPy, SciPy |
| Histogram data | Plotly (server-side histogram binning), Kaleido (PNG export for PDF) |
| PDF generation | ReportLab |
| Frontend | Next.js 16 + React 19 + TypeScript |
| Charts (UI) | Chart.js + react-chartjs-2 (histograms, frontier scatter) |
| Styling | Tailwind CSS 4, CSS custom properties (dark theme) |

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
This is baked into the Next.js bundle at build time. On Vercel, set it in **Project Settings > Environment Variables** before deploying.

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
| `Simulation` | Integer simulation ID (1 ... N) |
| `Period` | Integer period index (0-based; 0 = Year 1, 1 = Year 2, ...) |
| *(asset columns)* | One column per asset class. Any name that is not a note column. Minimum 4 required. Values are period returns as fractions (e.g. `0.07` = 7%). |
| `('Note', 'ID')` | One column per structured note, named exactly `('Note', '123456')`. Values are period returns as fractions. Minimum 1 required. |

Column `Unnamed: 0` (pandas index export) is silently ignored.

### Sheet Detection
The tool looks for the data sheet by scanning (case-insensitive) for a sheet named `sheet1`, `data`, or `results`.

### Auto-Classification Sheet (optional)
If the file contains a sheet named `Tracking` or `Notes`, the tool reads:
- `NoteId` -- matches against detected note column IDs
- `Note Type` -- pre-populates the note type dropdown
- `Quote Used` -- used as the expected annual yield (%) for Income-type notes

---

## Application Workflow

The app uses a multi-route architecture with two areas: **public pages** (analysis, histograms, frontier) and **admin pages** (data upload, classification, portfolio building). Admin pages are protected by a password gate (click the gear icon in the top nav).

### Admin: Upload (`/admin/upload`)
1. User drags & drops an `.xlsx` file (or clicks to browse)
2. Backend validates structure, detects asset and note columns
3. If the file fingerprint matches a previous session, saved portfolios and classifications are automatically restored
4. Returns: asset list, note list, row count, 10-row data preview, and any auto-classification suggestions

### Admin: Classify Notes (`/admin/classify`)
1. Each detected note is displayed with a type dropdown: `Income | Growth | Digital | Absolute | MLCD | PPN | Snowball`
2. Notes auto-classified from the Tracking sheet show a blue **auto** badge
3. Income notes additionally require an expected annual yield (%)
4. All notes must be classified before proceeding
5. Classifications are saved to session and persisted to `portfolios_db.json`

### Admin: Portfolio Builder (`/admin/portfolio-builder`)
**Asset Metadata**
- User assigns each asset class an expected annual yield (%) and an economic bucket: `Equity | Fixed Income | Alternative | Cash`

**Portfolio Creation**
- User names a portfolio, selects assets, and assigns weights via sliders (must sum to 100%)
- Multiple named portfolios can be saved; each persists across back-navigation and re-uploads of the same file
- Portfolios can be reordered, renamed, and edited

### Admin: Portfolio Summary (`/admin/portfolio-summary`)
- Displays all saved portfolios as cards with configurable horizon (1 / 2 / 3 years) and risk-free rate
- Each card shows: Sharpe ratio, % Negative simulations, Shorty (excess kurtosis), Expected Income %, Mean Return, and a visual allocation breakdown
- Notes section lists all classified notes with type badges and yields
- See [CALCULATIONS.md](CALCULATIONS.md) for the full metric definitions

### Admin: Framework Config (`/admin/framework-config`)
- 27-cell configurable grid (Outlook x Risk Tolerance x Goal)
- Each cell controls: allowed note types, allowed underliers, allowed protection types, protection range, and maximum allocation %
- Outlook Buckets tab configures which asset buckets are reduced per market outlook
- Saving triggers a background pre-calculation refresh

### Analysis (`/analysis`)
The main dashboard where users configure their analysis parameters:

1. **Select Base Portfolio** -- cards showing each saved portfolio with key metrics for the selected horizon
2. **Framework & Horizon** -- select Market Outlook (Bearish/Neutral/Bullish), Risk Tolerance (Conservative/Moderate/Aggressive), Portfolio Goal (Growth/Balanced/Income), and Simulation Horizon (1/2/3 years)
3. **Note Allocation Range** -- set min and max allocation percentages for candidate filtering
4. **Top 5 Candidates Table** -- ranked candidates with delta metrics vs base, computed client-side from pre-calculated data. Each row links to a detailed histogram view.

All selections update results instantly (no server round-trip required for filtering and ranking).

### Histogram Detail (`/histogram/[index]`)
- Full-width overlay histogram comparing base vs candidate return distributions
- Rendered with Chart.js (bar + smoothed line overlays)
- Key metrics displayed: Sharpe, % Negative, Return, Std Dev, Shorty, Downside Kurtosis, Expected Income
- Navigation between candidates via prev/next buttons
- Candidate identified by `note_id` URL parameter to avoid client/server index mismatches

### Histogram Summary (`/histograms`)
- 5-column card grid showing all improvement candidates with mini histograms
- Each card shows a sparkline-style histogram and key metric deltas
- Click any card to navigate to the full histogram detail

### Efficient Frontier (`/frontier`)
- Scatter chart visualising risk (std dev) vs return (mean) trade-offs
- Three layers: base portfolio points (gold), note candidate cloud (coloured by note type), and Pareto-optimal frontier line (teal dashed)
- Switchable between Bullish/Neutral/Bearish outlooks
- Fixed at 2-year horizon
- See [CALCULATIONS.md](CALCULATIONS.md) for the frontier construction algorithm

---

## Session Persistence

The backend persists state to `backend/portfolios_db.json`, keyed by a 16-character MD5 fingerprint of the file's columns, first row, and row count.

**What persists across re-uploads of the same file:**
- Note classifications and yields
- Asset yields and bucket assignments
- All saved portfolio names and weights

**What does not persist:**
- Improvement results (must re-run after upload)
- The simulation DataFrame itself (held only in memory)

**Session restore on page load:**
The frontend fetches `/session-state` on mount and auto-selects the first portfolio if data is available. Pre-calculated metrics are loaded in the background.

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/reset` | Clear in-memory session |
| `POST` | `/upload` | Parse `.xlsx`, detect columns, restore persisted state |
| `POST` | `/classify-notes` | Save note type + yield classifications |
| `POST` | `/asset-metadata` | Save asset yields + bucket assignments |
| `POST` | `/portfolio/save` | Save a named portfolio with weights; triggers pre-calculation |
| `DELETE` | `/portfolio/{name}` | Delete a saved portfolio |
| `GET` | `/portfolios` | List all saved portfolios |
| `GET` | `/portfolio-precalc` | Return all pre-computed candidate data |
| `POST` | `/precalc/{portfolio_name}` | Manually trigger pre-calculation for a portfolio |
| `GET` | `/framework-config` | Return current 27-cell framework configuration |
| `POST` | `/framework-config` | Update framework config; re-runs pre-calc for all portfolios |
| `POST` | `/framework-config/reset` | Reset framework config to defaults |
| `POST` | `/find-improvements` | Filter pre-computed candidates by framework cell, return top 5 |
| `GET` | `/portfolio-summary` | Stats for all portfolios (horizon + RFR params) |
| `GET` | `/portfolio-candidates` | All note x allocation combinations (pre-framework filtering) |
| `GET` | `/improvement-detail/{index}` | Improvement details with overlay histogram data |
| `GET` | `/histogram/{index}` | Plotly JSON for base vs candidate overlay |
| `GET` | `/efficient-frontier` | Mean vs std for all portfolios and note candidates (horizon=2) |
| `GET` | `/export/csv` | Download improvements table as CSV |
| `GET` | `/export/pdf` | Download full report as PDF |
| `GET` | `/session-state` | Return current session metadata for frontend restore |
| `GET` | `/files` | List all previously uploaded file fingerprints |
| `POST` | `/dev/load-test-file` | Dev only: load `Test2.xlsx` from disk |

---

## Deployment

### Backend -- Render
- Service type: Web Service
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Root directory: `backend/`
- Python version: set in `/runtime.txt` at repo root (currently `3.11.9`)
- Set env var: `CORS_ORIGINS=https://your-vercel-domain.vercel.app`

### Frontend -- Vercel
- Framework preset: Next.js
- Root directory: `frontend/`
- Set env var **before deploying**: `NEXT_PUBLIC_API_URL=https://your-render-backend.onrender.com`
  - This value is baked into the bundle at build time -- changes require a redeploy

---

## Project Structure

```
portfolio/
├── backend/
│   ├── main.py                # FastAPI app, all endpoints, session management
│   ├── calculations.py        # Monte Carlo engine, metrics, improvement search
│   ├── requirements.txt
│   └── portfolios_db.json     # Persisted session state (auto-created)
├── frontend/
│   ├── app/
│   │   ├── layout.tsx         # Root layout: AppProvider + TopNav
│   │   ├── page.tsx           # Redirects to /analysis
│   │   ├── globals.css        # CSS custom properties (dark theme)
│   │   ├── analysis/
│   │   │   └── page.tsx       # Main analysis dashboard
│   │   ├── histogram/
│   │   │   └── [index]/
│   │   │       └── page.tsx   # Histogram detail with overlay charts
│   │   ├── histograms/
│   │   │   └── page.tsx       # Histogram summary grid
│   │   ├── frontier/
│   │   │   └── page.tsx       # Efficient frontier scatter chart
│   │   └── admin/
│   │       ├── layout.tsx     # Admin nav + password gate
│   │       ├── upload/page.tsx
│   │       ├── classify/page.tsx
│   │       ├── portfolio-builder/page.tsx
│   │       ├── portfolio-summary/page.tsx
│   │       └── framework-config/page.tsx
│   ├── components/
│   │   ├── TopNav.tsx              # Top navigation bar
│   │   ├── AdminPasswordModal.tsx  # Admin password gate modal
│   │   ├── ImprovementDetail.tsx   # Improvement detail overlay
│   │   ├── Screen1Upload.tsx       # Upload UI (used by /admin/upload)
│   │   ├── Screen2ClassifyNotes.tsx # Note classification (used by /admin/classify)
│   │   ├── Screen3PortfolioBuilder.tsx # Portfolio builder (used by /admin/portfolio-builder)
│   │   └── Screen4PortfolioSummary.tsx # Portfolio summary (used by /admin/portfolio-summary)
│   └── lib/
│       ├── AppContext.tsx     # Global state: framework, portfolios, auth, precalc
│       ├── api.ts             # API client + TypeScript interfaces
│       ├── chartUtils.ts      # Histogram binning + smoothing for Chart.js
│       └── ranking.ts         # Client-side candidate filtering and ranking
├── runtime.txt                # Python version for Render (3.11.9)
├── README.md                  # This file
└── CALCULATIONS.md            # Mathematical methodology reference
```
