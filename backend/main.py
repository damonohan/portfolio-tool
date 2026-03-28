"""
FastAPI backend for the Portfolio Construction & Note Allocation Improvement Tool.
Session state is in-memory; portfolio/metadata state is persisted to a local JSON file
keyed by a file fingerprint so portfolios survive server restarts and work across
multiple uploaded files.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from calculations import (
    ALL_BUCKETS,
    NOTE_TYPES_GROWTH,
    NOTE_TYPES_INCOME,
    # compute_cumulative_returns no longer used — replaced by _cum_returns (numpy-native)
    compute_metrics,
    expected_income,
    find_improvements,
    # portfolio_returns no longer used — replaced by direct numpy @ operator
    rank_score,
)

app = FastAPI(title="Portfolio Tool API")

_cors_origins_env = os.environ.get("CORS_ORIGINS", "")
_cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()] or ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Persistent storage paths ──────────────────────────────────────────────────
# Set DATA_DIR=/data on Render (persistent disk mount) to survive redeploys.
# Falls back to the backend/ directory for local dev.
DATA_DIR    = os.environ.get("DATA_DIR", os.path.dirname(__file__))
DB_PATH     = os.path.join(DATA_DIR, "portfolios_db.json")
UPLOAD_PATH = os.path.join(DATA_DIR, "simulation.xlsx")


def _load_db() -> dict[str, Any]:
    if os.path.exists(DB_PATH):
        try:
            with open(DB_PATH) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_db(db: dict[str, Any]) -> None:
    with open(DB_PATH, "w") as f:
        json.dump(db, f, indent=2)


def _fingerprint(df: pd.DataFrame) -> str:
    """Stable hash of column names + first data row + row count."""
    cols = "|".join(str(c) for c in df.columns)
    first = "|".join(df.iloc[0].astype(str).tolist()) if len(df) > 0 else ""
    raw = f"{cols}||{first}||{len(df)}"
    return hashlib.md5(raw.encode()).hexdigest()[:16]


def _db_save_session(fp: str) -> None:
    """Persist current session's mutable state under the given fingerprint."""
    if not fp:
        return
    db = _load_db()
    entry = db.get(fp, {})
    entry.update({
        "note_meta":     SESSION["note_meta"],
        "asset_yields":  SESSION["asset_yields"],
        "asset_buckets": SESSION["asset_buckets"],
        "portfolios":    {
            name: {"name": p["name"], "weights": p["weights"], "risk_free": p.get("risk_free", 2.0)}
            for name, p in SESSION["portfolios"].items()
        },
        "precalc":    SESSION["precalc"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    db[fp] = entry
    # Persist framework_config at top level (not fingerprint-keyed — global across files)
    if SESSION.get("framework_config"):
        db["framework_config"] = SESSION["framework_config"]
    _save_db(db)


def _db_save_framework_config() -> None:
    """Persist framework_config at top level of DB (independent of file fingerprint)."""
    db = _load_db()
    db["framework_config"] = SESSION["framework_config"]
    _save_db(db)


def _db_load_framework_config() -> None:
    """Load framework_config from DB top-level key into SESSION.
    Auto-merges any new default types added in code into saved cells."""
    db = _load_db()
    saved = db.get("framework_config")
    if saved and saved.get("cells"):
        # Merge any new default types into saved cells (e.g. Snowball added after initial save)
        dirty = False
        for key, cell in saved["cells"].items():
            outlook = key.split("|")[0]
            defaults = _DEFAULT_TYPES.get(outlook, [])
            existing = set(cell.get("allowed_types", []))
            for t in defaults:
                if t not in existing:
                    cell["allowed_types"].append(t)
                    dirty = True
        SESSION["framework_config"] = saved
        if dirty:
            db["framework_config"] = saved
            _save_db(db)
    else:
        SESSION["framework_config"] = _default_framework_config()


# ── In-memory session store ───────────────────────────────────────────────────

SESSION: dict[str, Any] = {
    "df":                None,   # kept only during upload for preview; set to None after
    "sim_data":          None,   # numpy float32 array: shape (n_sims, n_periods, n_cols)
    "sim_col_idx":       {},     # {col_name: int} — maps column names to sim_data axis-2 indices
    "n_sims":            0,
    "n_periods":         0,
    "asset_cols":        [],
    "note_ids":          [],
    "note_col_map":      {},
    "note_meta":         {},
    "asset_yields":      {},
    "asset_buckets":     {},
    "portfolios":        {},
    "precalc":           {},   # {portfolio_name: {"_base": {h: metrics}, "Bullish": {h: [...]}, ...}}
    "improvements":      None,
    "improvements_meta": None, # {base_returns, base_metrics, framework}
    "fingerprint":       "",
    "note_suggestions":  {},   # auto-classified from Tracking/Notes sheet
    "framework_config":  {},   # configurable 27-cell eligibility grid (persisted top-level in DB)
}


def reset_session() -> None:
    global SESSION
    SESSION = {
        "df":                None,
        "sim_data":          None,
        "sim_col_idx":       {},
        "n_sims":            0,
        "n_periods":         0,
        "asset_cols":        [],
        "note_ids":          [],
        "note_col_map":      {},
        "note_meta":         {},
        "asset_yields":      {},
        "asset_buckets":     {},
        "portfolios":        {},
        "precalc":           {},
        "improvements":      None,
        "improvements_meta": None,
        "fingerprint":       "",
        "note_suggestions":  {},
        "framework_config":  _default_framework_config(),
    }


# ── helpers ───────────────────────────────────────────────────────────────────

def _note_col_to_id(col: str) -> str | None:
    """Extract numeric ID from column like ('Note', '1234567')."""
    m = re.match(r"^\('Note',\s*'(\w+)'\)$", col.strip())
    return m.group(1) if m else None


def _require_data() -> np.ndarray:
    """Return the sim_data numpy array, raising 400 if no file uploaded."""
    if SESSION["sim_data"] is None:
        raise HTTPException(400, "No file uploaded yet.")
    return SESSION["sim_data"]


def _require_df() -> pd.DataFrame:
    """Legacy helper — kept for upload/fingerprint only."""
    if SESSION["df"] is None:
        raise HTTPException(400, "No file uploaded yet.")
    return SESSION["df"]


def _cum_returns(columns: list[str], horizon: int) -> np.ndarray:
    """Compute cumulative returns from the numpy sim_data array.
    Returns shape (n_sims, len(columns)) as float64 for precision.
    Indexes columns first to avoid creating a full 139-column intermediate."""
    raw = SESSION["sim_data"]       # (n_sims, n_periods, n_all_cols), float32
    col_idx = SESSION["sim_col_idx"]
    indices = [col_idx[c] for c in columns]
    # Index columns first, then time — avoids full-width intermediate
    sub = np.ascontiguousarray(raw[:, :horizon, :][:, :, indices]).astype(np.float64)
    return np.prod(1 + sub, axis=1) - 1  # (n_sims, len(columns))


# ── Framework config helpers ──────────────────────────────────────────────────

_OUTLOOKS       = ("Bullish", "Neutral", "Bearish")
_RISKS          = ("Conservative", "Moderate", "Aggressive")
_GOALS          = ("Growth", "Balanced", "Income")
_MAX_ALLOC      = 30.0   # flat max allocation for every cell

_DEFAULT_TYPES: dict[str, list[str]] = {
    "Bullish": ["Growth", "Digital", "Absolute", "Snowball"],
    "Neutral": ["Growth", "Digital", "Absolute", "Snowball", "Income", "MLCD", "PPN"],
    "Bearish": ["Income", "MLCD", "PPN", "Absolute", "Snowball"],
}
# Min protection % tiered by risk × outlook (same for all 3 goals within each combo)
_DEFAULT_MIN_PROT: dict[str, dict[str, float]] = {
    "Conservative": {"Bullish": 0.0, "Neutral": 0.0, "Bearish": 0.0},
    "Moderate":     {"Bullish": 0.0, "Neutral": 0.0, "Bearish": 0.0},
    "Aggressive":   {"Bullish": 0.0, "Neutral": 0.0, "Bearish": 0.0},
}


def _default_cell(outlook: str, risk: str, _goal: str) -> dict:
    return {
        "allowed_types":            list(_DEFAULT_TYPES[outlook]),
        "allowed_underlyings":      [],
        "allowed_protection_types": [],
        "min_protection_pct":       _DEFAULT_MIN_PROT[risk][outlook],
        "max_protection_pct":       100.0,
        "max_alloc_pct":            _MAX_ALLOC,
    }


def _default_framework_config() -> dict:
    cells = {
        f"{o}|{r}|{g}": _default_cell(o, r, g)
        for o in _OUTLOOKS for r in _RISKS for g in _GOALS
    }
    return {
        "outlook_buckets": {
            "Bullish": ["Equity"],
            "Bearish": ["Equity", "Fixed Income"],
            "Neutral": ["Equity", "Fixed Income", "Alternative", "Cash"],
        },
        "cells": cells,
    }


# ── Pre-calculation ───────────────────────────────────────────────────────────


def _run_precalc(portfolio_name: str) -> None:
    """
    Pre-compute candidate metrics for all 3 outlooks × 3 horizons × notes × alloc steps.
    Stores results in SESSION["precalc"][portfolio_name].
    No port_returns stored — only metrics (compact for DB persistence).
    """
    if SESSION["sim_data"] is None:
        return
    port = SESSION["portfolios"].get(portfolio_name)
    if not port:
        return

    weights       = port["weights"]
    risk_free     = port.get("risk_free", 2.0)
    asset_cols    = list(weights.keys())
    asset_buckets = SESSION["asset_buckets"]
    asset_yields  = SESSION["asset_yields"]   # {asset: % value, e.g. 3.5}
    note_col_map  = SESSION["note_col_map"]   # {note_id: raw_col}
    note_meta     = SESSION["note_meta"]      # {note_id: {type, yield_pct}}
    note_ids      = SESSION["note_ids"]

    if not asset_buckets or not note_meta:
        return

    all_note_cols = [note_col_map[nid] for nid in note_ids if nid in note_col_map]
    all_cols      = asset_cols + all_note_cols
    col_idx       = SESSION["sim_col_idx"]

    result: dict[str, Any] = {
        "_base":   {},
        "Bullish": {},
        "Bearish": {},
        "Neutral": {},
    }

    # Asset yields as fractions for income_boost calculation
    asset_yields_frac = {a: y / 100.0 for a, y in asset_yields.items()}

    # Framework config for bucket selection per outlook
    fw_cfg      = SESSION.get("framework_config") or _default_framework_config()
    out_buckets = fw_cfg.get("outlook_buckets", _default_framework_config()["outlook_buckets"])
    global_max  = 0.40

    # Pre-compute outlook bucket info (invariant across horizons)
    outlook_info: dict[str, tuple[list[str], float]] = {}
    for outlook in ("Bullish", "Bearish", "Neutral"):
        allowed_buckets = set(out_buckets.get(outlook, []))
        bucket_assets = [a for a, b in asset_buckets.items() if b in allowed_buckets and a in weights]
        bucket_total  = sum(weights[a] for a in bucket_assets)
        outlook_info[outlook] = (bucket_assets, bucket_total)

    # Pre-compute column indices for assets and notes
    asset_indices = [col_idx[c] for c in asset_cols]
    w_arr_base    = np.array([weights[a] for a in asset_cols], dtype=np.float64)

    # Process ONE horizon at a time; only extract needed columns (~1MB vs ~11MB)
    raw = SESSION["sim_data"]  # (n_sims, n_periods, n_all_cols), float32
    for h in (1, 2, 3):
        hs = str(h)
        # Asset cumulative returns ONLY (14 cols ≈ 1.1MB, not all 139 cols ≈ 11MB)
        asset_sub = np.ascontiguousarray(raw[:, :h, :][:, :, asset_indices]).astype(np.float64)
        asset_arr = np.prod(1 + asset_sub, axis=1) - 1  # (n_sims, n_assets)
        del asset_sub

        # Base metrics
        base_ret = asset_arr @ w_arr_base
        m        = compute_metrics(base_ret, risk_free, h)
        inc_pct  = expected_income(weights, asset_yields)
        result["_base"][hs] = {
            "sharpe":               round(m["sharpe"],        4),
            "pct_neg":              round(m["pct_neg"],       4),
            "shorty":               round(m["shorty"],        4),
            "downside_kurt":        round(m["downside_kurt"], 4),
            "mean":                 round(m["mean"],          4),
            "std":                  round(m["std"],           4),
            "expected_income_pct":  round(inc_pct,            4),
        }

        # Candidates for all 3 outlooks at this horizon
        for outlook in ("Bullish", "Bearish", "Neutral"):
            bucket_assets, bucket_total = outlook_info[outlook]

            if bucket_total <= 0:
                result[outlook][hs] = []
                continue

            base_m    = result["_base"][hs]
            base_inc  = base_m["expected_income_pct"] / 100.0
            candidates: list[dict] = []

            for note_id in note_ids:
                note_col = note_col_map.get(note_id)
                if note_col is None or note_col not in col_idx:
                    continue
                meta      = note_meta.get(note_id, {})
                ext       = SESSION.get("note_suggestions", {}).get(note_id, {})
                note_type = meta.get("type", "")
                is_income = meta.get("income_eligible", note_type in NOTE_TYPES_INCOME)
                note_yield_frac = meta.get("yield_pct", 0.0) / 100.0 if is_income else 0.0
                # Compute cumulative return for this ONE note column (~80KB)
                note_ci = col_idx[note_col]
                note_sub = raw[:, :h, note_ci].astype(np.float64)  # (n_sims, h)
                note_arr = np.prod(1 + note_sub, axis=1) - 1 if h > 1 else note_sub.ravel()

                step  = 0.05
                alloc = step
                while alloc <= global_max + 1e-9:
                    alloc_r = round(alloc, 4)
                    if alloc_r > bucket_total + 1e-6:
                        alloc += step
                        continue

                    new_weights = dict(weights)
                    for a in bucket_assets:
                        new_weights[a] = weights[a] - (weights[a] / bucket_total) * alloc_r

                    new_w_arr = np.array([new_weights[a] for a in asset_cols])
                    port_ret  = asset_arr @ new_w_arr + note_arr * alloc_r

                    m = compute_metrics(port_ret, risk_free, h)

                    new_income = sum(new_weights.get(a, 0.0) * asset_yields_frac.get(a, 0.0) for a in asset_cols)
                    if is_income:
                        new_income += alloc_r * note_yield_frac
                    income_boost = new_income - base_inc

                    improves = (
                        m["sharpe"]        >= base_m["sharpe"]        or
                        m["pct_neg"]       <= base_m["pct_neg"]       or
                        m["shorty"]        <= base_m["shorty"]        or
                        m["downside_kurt"] <= base_m["downside_kurt"] or
                        (is_income and income_boost > 0)
                    )
                    if improves:
                        candidates.append({
                            "note_id":        note_id,
                            "note_type":      note_type,
                            "alloc_pct":      alloc_r,
                            "underlier":       ext.get("underlier",       ""),
                            "protection_type": ext.get("protection_type", ""),
                            "protection_pct":  ext.get("protection_pct",  0.0),
                            "metrics": {
                                "sharpe":        round(m["sharpe"],        4),
                                "pct_neg":       round(m["pct_neg"],       4),
                                "shorty":        round(m["shorty"],        4),
                                "downside_kurt": round(m["downside_kurt"], 4),
                                "income_boost":  round(income_boost,       6),
                            },
                        })

                    alloc += step

            result[outlook][hs] = candidates

        del asset_arr  # free before next horizon

    SESSION["precalc"][portfolio_name] = result


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    """Auto-load the last uploaded file and framework config on startup."""
    # Always restore framework config first (independent of file)
    _db_load_framework_config()
    # Then restore file + portfolio data if available
    if os.path.exists(UPLOAD_PATH):
        try:
            with open(UPLOAD_PATH, "rb") as f:
                contents = f.read()
            _parse_and_load_xlsx(contents, "simulation.xlsx")
            # Precalc is restored from portfolios_db.json during parse.
            # Do NOT re-run precalc here — with 125+ notes it causes OOM.
            # Frontend triggers lazy precalc per portfolio via POST /precalc/{name}.
        except Exception:
            pass  # non-fatal — user can re-upload if file is corrupt


@app.post("/reset")
def reset():
    reset_session()
    return {"ok": True}


def _parse_and_load_xlsx(contents: bytes, filename: str = "upload.xlsx") -> dict:
    """Parse xlsx bytes into SESSION and persist state. Returns metadata dict.
    Raises HTTPException on invalid file structure."""
    _xl = pd.ExcelFile(io.BytesIO(contents))
    _data_sheet = next(
        (s for s in _xl.sheet_names if s.strip().lower() in ("sheet1", "data", "results")),
        None,
    )
    if _data_sheet is None:
        raise HTTPException(
            400,
            f"Could not find a data sheet. Expected a sheet named 'Sheet1', 'Data', or 'Results'. "
            f"Found: {', '.join(_xl.sheet_names)}"
        )
    try:
        df = pd.read_excel(_xl, sheet_name=_data_sheet)
    except Exception as e:
        raise HTTPException(400, f"Could not parse sheet '{_data_sheet}': {e}")

    # ── Auto-classification: parse Tracking / Notes sheet if present ──────────
    note_suggestions: dict[str, dict] = {}
    _tracking_sheet = next(
        (s for s in _xl.sheet_names if s.strip().lower() in ("tracking", "notes")),
        None,
    )
    if _tracking_sheet:
        try:
            tr = pd.read_excel(_xl, sheet_name=_tracking_sheet, header=0)
            tr.columns = [str(c).strip() for c in tr.columns]
            if "NoteId" in tr.columns and "Note Type" in tr.columns:
                for _, row in tr.iterrows():
                    nid = str(int(row["NoteId"])) if pd.notna(row["NoteId"]) else None
                    if not nid:
                        continue
                    raw_type = str(row.get("Note Type", "")).strip()
                    note_type = raw_type if raw_type in VALID_TYPES else ""
                    yield_pct = 0.0
                    if note_type == "Income":
                        q = row.get("Quote Used")
                        if pd.notna(q):
                            try:
                                yield_pct = float(q)
                            except (ValueError, TypeError):
                                yield_pct = 0.0
                    note_suggestions[nid] = {
                        "type":               note_type,
                        "yield_pct":          yield_pct,
                        "underlier":          str(row.get("Underlier", "") or "").strip(),
                        "protection_type":    str(row.get("Protection Type", "") or "").strip(),
                        "protection_pct":     float(row["Protection %"]) if pd.notna(row.get("Protection %")) else 0.0,
                        "coupon_protection":  float(row["Coupon Protection"]) if pd.notna(row.get("Coupon Protection")) else None,
                        "callability":        str(row.get("Callability", "") or "").strip(),
                        "solve_for_param":    str(row.get("Solve For Param", "") or "").strip(),
                        "quote_used":         float(row["Quote Used"]) if pd.notna(row.get("Quote Used")) else 0.0,
                    }
        except Exception:
            pass  # non-fatal — user classifies manually

    # Validate required columns
    if "Simulation" not in df.columns or "Period" not in df.columns:
        raise HTTPException(400, "Sheet1 must have 'Simulation' and 'Period' columns.")

    # Detect asset vs note columns (everything after Period)
    skip_cols = {"Simulation", "Period"}
    all_data_cols = []
    past_period = False
    for c in df.columns:
        if c == "Period":
            past_period = True
            continue
        if not past_period:
            continue  # skip Simulation and anything before Period
        cstr = str(c).strip()
        if cstr and cstr.lower().startswith("unnamed"):
            continue   # skip unnamed index columns
        if cstr:
            all_data_cols.append(c)

    note_ids: list[str] = []
    note_col_map: dict[str, str] = {}
    asset_cols: list[str] = []
    in_notes = False

    for col in all_data_cols:
        col_str = str(col).strip()
        nid = _note_col_to_id(col_str)
        if nid:
            in_notes = True
            note_ids.append(nid)
            note_col_map[nid] = col
        elif not in_notes:
            asset_cols.append(col)

    if len(asset_cols) < 4:
        raise HTTPException(400, f"Expected ≥4 asset class columns, found {len(asset_cols)}.")
    if len(note_ids) < 1:
        raise HTTPException(400, "No note columns detected.")

    # Clean up df – coerce numeric
    numeric_cols = asset_cols + list(note_col_map.values())
    df[numeric_cols] = df[numeric_cols].apply(pd.to_numeric, errors="coerce")
    df["Simulation"] = pd.to_numeric(df["Simulation"], errors="coerce")
    df["Period"]     = pd.to_numeric(df["Period"], errors="coerce")
    df.dropna(subset=["Simulation", "Period"], inplace=True)
    df["Simulation"] = df["Simulation"].astype(int)
    df["Period"]     = df["Period"].astype(int)

    # Fingerprint and restore persisted state if this file was seen before
    fp = _fingerprint(df)
    db = _load_db()
    saved = db.get(fp, {})
    restored_portfolios = 0

    # Extract numpy array from DataFrame for memory-efficient storage
    all_data_cols = asset_cols + list(note_col_map.values())
    sorted_df  = df.sort_values(["Simulation", "Period"])
    n_sims     = int(sorted_df["Simulation"].nunique())
    n_periods  = int(sorted_df["Period"].nunique())
    sim_data   = sorted_df[all_data_cols].values.reshape(n_sims, n_periods, len(all_data_cols)).astype(np.float32)
    sim_col_idx = {c: i for i, c in enumerate(all_data_cols)}

    SESSION["sim_data"]          = sim_data
    SESSION["sim_col_idx"]       = sim_col_idx
    SESSION["n_sims"]            = n_sims
    SESSION["n_periods"]         = n_periods
    SESSION["df"]                = None  # DataFrame no longer needed — saves ~34MB+
    SESSION["asset_cols"]        = asset_cols
    SESSION["note_ids"]          = note_ids
    SESSION["note_col_map"]      = note_col_map
    SESSION["fingerprint"]       = fp
    SESSION["improvements"]      = None
    SESSION["improvements_meta"] = None
    SESSION["note_suggestions"]  = note_suggestions

    if saved:
        # Restore only data that matches the current asset/note structure
        SESSION["note_meta"]     = saved.get("note_meta", {})
        SESSION["asset_yields"]  = saved.get("asset_yields", {a: 0.0 for a in asset_cols})
        SESSION["asset_buckets"] = saved.get("asset_buckets", {})
        raw_ports = saved.get("portfolios", {})
        # Re-validate portfolio weights against current asset list
        valid_ports = {}
        for name, p in raw_ports.items():
            w = {a: v for a, v in p["weights"].items() if a in asset_cols}
            if w and abs(sum(w.values()) - 1.0) < 0.01:
                valid_ports[name] = {
                    "name":      name,
                    "weights":   w,
                    "risk_free": p.get("risk_free", 2.0),
                }
        SESSION["portfolios"]    = valid_ports
        SESSION["precalc"]       = saved.get("precalc", {})
        # Only keep precalc entries for valid portfolios
        SESSION["precalc"] = {k: v for k, v in SESSION["precalc"].items() if k in valid_ports}
        restored_portfolios = len(valid_ports)
    else:
        SESSION["note_meta"]     = {}
        SESSION["asset_yields"]  = {a: 0.0 for a in asset_cols}
        SESSION["asset_buckets"] = {}
        SESSION["portfolios"]    = {}
        SESSION["precalc"]       = {}
        # Seed the DB entry with file metadata
        db[fp] = {
            "filename":      filename,
            "row_count":     len(df),
            "asset_cols":    asset_cols,
            "note_ids":      note_ids,
            "note_meta":     {},
            "asset_yields":  {a: 0.0 for a in asset_cols},
            "asset_buckets": {},
            "portfolios":    {},
            "precalc":       {},
            "created_at":    datetime.now(timezone.utc).isoformat(),
            "updated_at":    datetime.now(timezone.utc).isoformat(),
        }
        _save_db(db)

    # ── Auto-classify notes if Tracking sheet covers every data note ID ──────
    auto_classified = False
    if (
        note_suggestions
        and set(note_ids) <= set(note_suggestions.keys())  # tracking covers all data notes
        and not SESSION["note_meta"]   # don't overwrite a restored DB entry
    ):
        SESSION["note_meta"] = {
            nid: {
                "type":      note_suggestions[nid]["type"],
                "yield_pct": note_suggestions[nid]["yield_pct"] if note_suggestions[nid]["type"] == "Income" else 0.0,
            }
            for nid in note_ids
            if note_suggestions.get(nid, {}).get("type") in VALID_TYPES
        }
        if set(SESSION["note_meta"].keys()) == set(note_ids):
            _db_save_session(SESSION["fingerprint"])
            auto_classified = True
        else:
            SESSION["note_meta"] = {}  # incomplete — user must classify manually

    preview = df.head(10).replace({float("nan"): None}).to_dict(orient="records")

    return {
        "asset_cols":           asset_cols,
        "note_ids":             note_ids,
        "row_count":            len(df),
        "fingerprint":          fp,
        "restored_portfolios":  restored_portfolios,
        "restored_note_meta":   bool(SESSION["note_meta"]),
        "restored_asset_meta":  bool(SESSION["asset_buckets"]),
        "note_suggestions":     note_suggestions,
        "auto_classified":      auto_classified,
        "preview":              preview,
    }


@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith(".xlsx"):
        raise HTTPException(400, "Only .xlsx files are accepted.")
    contents = await file.read()
    result = _parse_and_load_xlsx(contents, file.filename)
    # Restore framework config after parse (parse resets SESSION but config is global)
    _db_load_framework_config()
    # Persist to disk so the file survives backend restarts / redeploys
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(UPLOAD_PATH, "wb") as f:
        f.write(contents)
    return result


# ── Note classification ───────────────────────────────────────────────────────

class NoteClassification(BaseModel):
    note_id:          str
    note_type:        str
    yield_pct:        float = 0.0
    income_eligible:  bool  = False


class ClassifyRequest(BaseModel):
    classifications: list[NoteClassification]


VALID_TYPES = {"Income", "Growth", "Digital", "Absolute", "MLCD", "PPN", "Snowball"}


@app.post("/classify-notes")
def classify_notes(req: ClassifyRequest):
    _require_data()
    meta: dict[str, dict] = {}
    for c in req.classifications:
        if c.note_type not in VALID_TYPES:
            raise HTTPException(400, f"Invalid note type: {c.note_type}")
        if c.note_id not in SESSION["note_ids"]:
            raise HTTPException(400, f"Unknown note ID: {c.note_id}")
        meta[c.note_id] = {
            "type":             c.note_type,
            "yield_pct":        c.yield_pct if c.income_eligible else 0.0,
            "income_eligible":  c.income_eligible,
        }
    if set(meta.keys()) != set(SESSION["note_ids"]):
        raise HTTPException(400, "All notes must be classified.")
    SESSION["note_meta"] = meta
    # Re-run precalc for all saved portfolios since note metadata changed
    if SESSION["portfolios"] and SESSION["asset_buckets"]:
        for name in list(SESSION["portfolios"].keys()):
            _run_precalc(name)
    _db_save_session(SESSION["fingerprint"])
    return {"ok": True}


# ── Asset metadata ────────────────────────────────────────────────────────────

class AssetMeta(BaseModel):
    asset:      str
    yield_pct:  float
    bucket:     str


class AssetMetaRequest(BaseModel):
    assets: list[AssetMeta]


VALID_BUCKETS = {"Equity", "Fixed Income", "Alternative", "Cash"}


@app.post("/asset-metadata")
def set_asset_metadata(req: AssetMetaRequest):
    _require_data()
    yields:  dict[str, float] = {}
    buckets: dict[str, str]   = {}
    for a in req.assets:
        if a.asset not in SESSION["asset_cols"]:
            raise HTTPException(400, f"Unknown asset: {a.asset}")
        if a.bucket not in VALID_BUCKETS:
            raise HTTPException(400, f"Invalid bucket: {a.bucket}")
        yields[a.asset]  = a.yield_pct
        buckets[a.asset] = a.bucket
    if set(yields.keys()) != set(SESSION["asset_cols"]):
        raise HTTPException(400, "All assets must have metadata.")
    SESSION["asset_yields"]  = yields
    SESSION["asset_buckets"] = buckets
    # Clear stale precalc — will be regenerated on next portfolio save or precalc trigger
    SESSION["precalc"] = {}
    _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "precalc_invalidated": bool(SESSION["portfolios"])}


# ── Portfolio management ──────────────────────────────────────────────────────

class PortfolioSave(BaseModel):
    name:      str
    weights:   dict[str, float]   # {asset: weight_0_to_100}
    risk_free: float = 2.0


@app.post("/portfolio/save")
def save_portfolio(req: PortfolioSave):
    _require_data()
    if not SESSION["asset_yields"] or not SESSION["asset_buckets"]:
        raise HTTPException(400, "Save asset yields & buckets before saving a portfolio.")
    if not req.name.strip():
        raise HTTPException(400, "Portfolio name is required.")
    for a in req.weights:
        if a not in SESSION["asset_cols"]:
            raise HTTPException(400, f"Unknown asset: {a}")
        if a in SESSION.get("note_col_map", {}):
            raise HTTPException(400, "Notes cannot be in portfolios.")
    total = sum(req.weights.values())
    if abs(total - 100.0) > 0.01:
        raise HTTPException(400, f"Weights must sum to 100 (got {total:.2f}).")
    # Convert to fractions
    fractions = {a: w / 100.0 for a, w in req.weights.items()}
    SESSION["portfolios"][req.name] = {
        "name":      req.name,
        "weights":   fractions,
        "risk_free": req.risk_free,
    }
    # Run pre-calculation if metadata is ready
    if SESSION["asset_buckets"] and SESSION["note_meta"]:
        _run_precalc(req.name)
    _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "portfolios": list(SESSION["portfolios"].keys()), "risk_free": req.risk_free}


@app.delete("/portfolio/{name}")
def delete_portfolio(name: str):
    if name not in SESSION["portfolios"]:
        raise HTTPException(404, "Portfolio not found.")
    del SESSION["portfolios"][name]
    # Clean up precalc entry
    SESSION["precalc"].pop(name, None)
    _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "portfolios": list(SESSION["portfolios"].keys())}


@app.get("/portfolios")
def list_portfolios():
    result = []
    for p in SESSION["portfolios"].values():
        result.append({
            "name":        p["name"],
            "asset_count": len(p["weights"]),
            "weights":     {a: round(w * 100, 2) for a, w in p["weights"].items()},
            "risk_free":   p.get("risk_free", 2.0),
        })
    return result


# ── Pre-calc endpoints ────────────────────────────────────────────────────────

@app.get("/portfolio-precalc")
def get_portfolio_precalc():
    """Return all pre-computed candidate data for all portfolios.
    Returns whatever is cached; missing portfolios are NOT auto-computed
    (use POST /precalc/{name} to trigger individually)."""
    _require_data()
    result = {}
    missing = []
    for name in SESSION["portfolios"]:
        if name in SESSION["precalc"]:
            port = SESSION["portfolios"].get(name, {})
            result[name] = {**SESSION["precalc"][name], "risk_free": port.get("risk_free", 2.0)}
        else:
            missing.append(name)
    return {"portfolios": result, "missing": missing}


@app.post("/precalc/{portfolio_name}")
def trigger_precalc(portfolio_name: str):
    """Manually trigger pre-calculation for a specific portfolio (e.g., after session restore)."""
    _require_data()
    if portfolio_name not in SESSION["portfolios"]:
        raise HTTPException(404, "Portfolio not found.")
    if not SESSION["asset_buckets"]:
        raise HTTPException(400, "Asset metadata not set.")
    if not SESSION["note_meta"]:
        raise HTTPException(400, "Notes not classified yet.")
    _run_precalc(portfolio_name)
    _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "portfolio_name": portfolio_name}


# ── Framework config endpoints ────────────────────────────────────────────────

@app.get("/framework-config")
def get_framework_config():
    cfg = SESSION.get("framework_config")
    if not cfg:
        cfg = _default_framework_config()
        SESSION["framework_config"] = cfg
    return cfg


class FrameworkConfigRequest(BaseModel):
    outlook_buckets: dict[str, list[str]]
    cells: dict[str, dict]


@app.post("/framework-config")
def save_framework_config(req: FrameworkConfigRequest):
    SESSION["framework_config"] = {
        "outlook_buckets": req.outlook_buckets,
        "cells":           req.cells,
    }
    _db_save_framework_config()
    # Invalidate precalc — framework rules changed, must recompute.
    # Frontend triggers lazy recompute per portfolio via POST /precalc/{name}.
    SESSION["precalc"] = {}
    if SESSION["fingerprint"]:
        _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "precalc_invalidated": bool(SESSION["portfolios"])}


@app.post("/framework-config/reset")
def reset_framework_config():
    """Reset framework config to built-in defaults and re-run precalc."""
    SESSION["framework_config"] = _default_framework_config()
    _db_save_framework_config()
    SESSION["precalc"] = {}
    if SESSION["fingerprint"]:
        _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "config": SESSION["framework_config"]}


# ── Improvement search ────────────────────────────────────────────────────────

class FindImprovementsRequest(BaseModel):
    portfolio_name: str
    outlook:        str
    risk_tolerance: str
    goal:           str
    horizon:        int   # 1, 2, or 3
    ensure_note_id: str | None = None  # If set, guarantee this note appears in results


@app.post("/find-improvements")
def find_improvements_endpoint(req: FindImprovementsRequest):
    _require_data()
    if req.portfolio_name not in SESSION["precalc"]:
        raise HTTPException(400, "No pre-calc data for this portfolio. Save the portfolio first.")
    if req.horizon not in (1, 2, 3):
        raise HTTPException(400, "Horizon must be 1, 2, or 3.")

    precalc_port = SESSION["precalc"][req.portfolio_name]
    h_key        = str(req.horizon)
    base_m       = precalc_port["_base"][h_key]
    candidates   = precalc_port.get(req.outlook, {}).get(h_key, [])

    # 27-cell config filter
    cell_key = f"{req.outlook}|{req.risk_tolerance}|{req.goal}"
    fw_cfg   = SESSION.get("framework_config") or _default_framework_config()
    cell     = fw_cfg.get("cells", {}).get(cell_key, _default_cell(req.outlook, req.risk_tolerance, req.goal))
    max_alloc_frac = cell.get("max_alloc_pct", 27.5) / 100.0
    allowed_types  = cell.get("allowed_types", [])
    allowed_und    = cell.get("allowed_underlyings", [])
    allowed_ptype  = cell.get("allowed_protection_types", [])
    min_prot       = cell.get("min_protection_pct", 0.0)
    max_prot       = cell.get("max_protection_pct", 100.0)

    # Filter and score
    scored: list[dict] = []
    for cand in candidates:
        if cand["alloc_pct"] > max_alloc_frac + 1e-9:
            continue
        if allowed_types and cand["note_type"] not in allowed_types:
            continue
        if allowed_und and cand.get("underlier", "") not in allowed_und:
            continue
        if allowed_ptype and cand.get("protection_type", "") not in allowed_ptype:
            continue
        prot = cand.get("protection_pct", 0.0)
        if prot < min_prot or prot > max_prot:
            continue
        score = rank_score(base_m, cand["metrics"], req.goal)
        scored.append({**cand, "score": score})

    # Sort descending, deduplicate by note_id, take top 5
    scored.sort(key=lambda x: x["score"], reverse=True)
    seen: set[str] = set()
    top5: list[dict] = []

    # If a specific note is requested, ensure it's included first
    if req.ensure_note_id:
        for c in scored:
            if c["note_id"] == req.ensure_note_id:
                seen.add(c["note_id"])
                top5.append(c)
                break

    for c in scored:
        if c["note_id"] not in seen:
            seen.add(c["note_id"])
            top5.append(c)
        if len(top5) == 5:
            break

    if not top5:
        SESSION["improvements"]      = []
        SESSION["improvements_meta"] = None
        return {
            "base": {
                "sharpe":               round(base_m["sharpe"],        4),
                "pct_neg":              round(base_m["pct_neg"],       4),
                "shorty":               round(base_m["shorty"],        4),
                "downside_kurt":        round(base_m.get("downside_kurt", 0), 4),
                "expected_income_pct":  round(base_m["expected_income_pct"], 4),
            },
            "improvements": [],
        }

    # Re-compute port_returns for top-5 only (needed for histograms)
    port       = SESSION["portfolios"][req.portfolio_name]
    weights    = port["weights"]
    risk_free  = port.get("risk_free", 2.0)
    asset_cols = list(weights.keys())

    out_bkts_cfg   = (SESSION.get("framework_config") or _default_framework_config())["outlook_buckets"]
    allowed_bkts   = set(out_bkts_cfg.get(req.outlook, []))
    bucket_assets  = [a for a, b in SESSION["asset_buckets"].items() if b in allowed_bkts and a in weights]
    bucket_total   = sum(weights[a] for a in bucket_assets) if bucket_assets else 0.0

    note_col_map   = SESSION["note_col_map"]
    note_meta      = SESSION["note_meta"]
    asset_yields_frac = {a: y / 100.0 for a, y in SESSION["asset_yields"].items()}

    all_note_cols = [note_col_map[nid] for nid in SESSION["note_ids"] if nid in note_col_map]
    all_cols      = asset_cols + all_note_cols
    col_idx       = SESSION["sim_col_idx"]

    # Compute cumulative returns for this horizon using numpy
    wealth     = _cum_returns(all_cols, req.horizon)
    asset_indices = [col_idx[c] for c in asset_cols]
    asset_arr  = wealth[:, :len(asset_cols)]  # columns ordered same as all_cols
    w_arr      = np.array([weights[a] for a in asset_cols])
    base_ret   = asset_arr @ w_arr

    results: list[dict] = []
    for c in top5:
        note_id   = c["note_id"]
        note_col  = note_col_map.get(note_id)
        if note_col is None or note_col not in col_idx:
            continue
        alloc_r   = c["alloc_pct"]  # fraction

        if bucket_total > 0 and bucket_assets:
            new_weights = dict(weights)
            for a in bucket_assets:
                new_weights[a] = weights[a] - (weights[a] / bucket_total) * alloc_r
        else:
            new_weights = dict(weights)

        new_w_arr   = np.array([new_weights[a] for a in asset_cols])
        note_ci     = all_cols.index(note_col)
        port_ret    = asset_arr @ new_w_arr + wealth[:, note_ci] * alloc_r

        m           = c["metrics"]
        income_boost = m["income_boost"]

        results.append({
            "note_id":            note_id,
            "note_type":          c["note_type"],
            "alloc_pct":          round(alloc_r * 100, 1),   # convert to % for response
            "new_sharpe":         round(m["sharpe"],        4),
            "new_pct_neg":        round(m["pct_neg"],       4),
            "new_shorty":         round(m["shorty"],        4),
            "new_downside_kurt":  round(m.get("downside_kurt", 0), 4),
            "income_boost":       round(income_boost,       4),
            "score":              round(c["score"],         6),
            "port_returns":       port_ret.tolist(),
        })

    SESSION["improvements"] = results
    SESSION["improvements_meta"] = {
        "base_returns":  base_ret.tolist(),
        "base_metrics":  base_m,
        "framework": {
            "outlook":        req.outlook,
            "risk_tolerance": req.risk_tolerance,
            "goal":           req.goal,
            "portfolio_name": req.portfolio_name,
            "horizon":        req.horizon,
            "risk_free":      risk_free,
        },
    }

    response_results = [{k: v for k, v in r.items() if k != "port_returns"} for r in results]

    return {
        "base": {
            "sharpe":               round(base_m["sharpe"],        4),
            "pct_neg":              round(base_m["pct_neg"],       4),
            "shorty":               round(base_m["shorty"],        4),
            "downside_kurt":        round(base_m.get("downside_kurt", 0), 4),
            "expected_income_pct":  round(base_m["expected_income_pct"], 4),
        },
        "improvements": response_results,
    }


# ── Histogram data ────────────────────────────────────────────────────────────

@app.get("/histogram/{index}")
def get_histogram(index: int):
    """Return Plotly figure JSON for recommendation at `index` (0-based)."""
    meta = SESSION.get("improvements_meta")
    if meta is None:
        raise HTTPException(400, "No improvements found. Run find-improvements first.")
    imps = SESSION.get("improvements", [])
    if index >= len(imps):
        raise HTTPException(404, "Improvement index out of range.")

    base_ret = np.array(meta["base_returns"])
    cand_ret = np.array(imps[index]["port_returns"])

    note_id  = imps[index]["note_id"]
    alloc    = imps[index]["alloc_pct"]

    fig = go.Figure()
    fig.add_trace(go.Histogram(
        x=base_ret * 100,
        name="Base Portfolio",
        opacity=0.75,
        marker_color="steelblue",
        histnorm="probability density",
        nbinsx=80,
    ))
    fig.add_trace(go.Histogram(
        x=cand_ret * 100,
        name=f"Note {note_id} @ {alloc}%",
        opacity=0.55,
        marker_color="darkorange",
        histnorm="probability density",
        nbinsx=80,
    ))
    fig.add_vline(x=0, line_dash="dash", line_color="red", annotation_text="0%")
    fig.update_layout(
        barmode="overlay",
        title=f"Return Distribution: Base vs Note {note_id} @ {alloc}%",
        xaxis_title="Final Cumulative Return (%)",
        yaxis_title="Density",
        legend=dict(x=0.01, y=0.99),
        template="plotly_white",
        height=400,
    )
    return json.loads(fig.to_json())


# ── Improvement detail (combined weights + metrics + histogram) ──────────────

@app.get("/improvement-detail/{index}")
def get_improvement_detail(index: int):
    """Return full before/after comparison data for improvement at `index`."""
    meta = SESSION.get("improvements_meta")
    if meta is None:
        raise HTTPException(400, "No improvements found. Run find-improvements first.")
    imps = SESSION.get("improvements", [])
    if index >= len(imps):
        raise HTTPException(404, "Improvement index out of range.")

    imp       = imps[index]
    fw        = meta["framework"]
    base_m    = meta["base_metrics"]
    port      = SESSION["portfolios"][fw["portfolio_name"]]
    weights   = port["weights"]           # {asset: fraction}
    risk_free = fw["risk_free"]
    horizon   = fw["horizon"]
    note_id   = imp["note_id"]
    alloc_pct = imp["alloc_pct"]          # already % (e.g. 10.0)
    alloc_r   = alloc_pct / 100.0

    # Note metadata
    ext = SESSION.get("note_suggestions", {}).get(note_id, {})
    underlier       = ext.get("underlier", note_id) or note_id
    protection_type = ext.get("protection_type", "")
    protection_pct  = ext.get("protection_pct", 0.0)
    note_type       = imp["note_type"]

    # Base weights → %
    base_weights = {a: round(w * 100, 2) for a, w in weights.items()}

    # After weights: reduce bucket assets proportionally (same logic as find-improvements)
    out_bkts_cfg  = (SESSION.get("framework_config") or _default_framework_config())["outlook_buckets"]
    allowed_bkts  = set(out_bkts_cfg.get(fw["outlook"], []))
    bucket_assets = [a for a, b in SESSION["asset_buckets"].items() if b in allowed_bkts and a in weights]
    bucket_total  = sum(weights[a] for a in bucket_assets) if bucket_assets else 0.0

    new_weights = dict(weights)
    if bucket_total > 0 and bucket_assets:
        for a in bucket_assets:
            new_weights[a] = weights[a] - (weights[a] / bucket_total) * alloc_r
    after_weights = {a: round(w * 100, 2) for a, w in new_weights.items()}
    note_label = f"{note_type}: {underlier}"
    after_weights[note_label] = round(alloc_r * 100, 2)

    # After metrics: compute mean from stored port_returns
    port_ret  = np.array(imp["port_returns"])
    after_m   = compute_metrics(port_ret, risk_free, horizon)
    after_inc = base_m["expected_income_pct"] + imp["income_boost"] * 100

    # Histogram (dark fintech theme)
    base_ret = np.array(meta["base_returns"])
    fig = go.Figure()
    fig.add_trace(go.Histogram(
        x=base_ret * 100,
        name="Base Portfolio",
        opacity=0.65,
        marker_color="rgba(6,182,212,0.7)",
        histnorm="probability density",
        nbinsx=80,
    ))
    fig.add_trace(go.Histogram(
        x=port_ret * 100,
        name=f"With {underlier}",
        opacity=0.55,
        marker_color="rgba(34,197,94,0.7)",
        histnorm="probability density",
        nbinsx=80,
    ))
    fig.add_vline(x=0, line_dash="dash", line_color="rgba(239,68,68,0.7)",
                  annotation_text="0%", annotation_font_color="rgba(239,68,68,0.8)")
    fig.update_layout(
        barmode="overlay",
        title=dict(text=f"Return Distribution: Base vs {underlier} @ {alloc_pct}%",
                   font=dict(color="#e2e8f0", size=16)),
        xaxis_title="Final Cumulative Return (%)",
        yaxis_title="Density",
        xaxis=dict(color="#94a3b8", gridcolor="#1e293b"),
        yaxis=dict(color="#94a3b8", gridcolor="#1e293b"),
        legend=dict(x=0.01, y=0.99, font=dict(color="#cbd5e1")),
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(15,23,42,0.6)",
        height=420,
        font=dict(color="#94a3b8"),
    )

    # Allocation curve: mean return at each allocation step for this note
    alloc_curve = [{"alloc_pct": 0, "mean_return": round(base_m["mean"] * 100, 2)}]
    note_col_map = SESSION["note_col_map"]
    note_col     = note_col_map.get(note_id)
    asset_cols   = list(weights.keys())
    if note_col and bucket_total > 0:
        all_cols   = asset_cols + [note_col]
        wealth     = _cum_returns(all_cols, horizon)
        asset_arr  = wealth[:, :len(asset_cols)]
        note_arr   = wealth[:, len(asset_cols)]
        w_arr_base = np.array([weights[a] for a in asset_cols])
        step = 0.05
        alloc_step = step
        while alloc_step <= alloc_r + 1e-9:
            ar = round(alloc_step, 4)
            step_weights = np.array([
                weights[a] - (weights[a] / bucket_total) * ar if a in bucket_assets else weights[a]
                for a in asset_cols
            ])
            step_ret = asset_arr @ step_weights + note_arr * ar
            step_m   = compute_metrics(step_ret, risk_free, horizon)
            alloc_curve.append({
                "alloc_pct": round(ar * 100, 1),
                "mean_return": round(step_m["mean"] * 100, 2),
            })
            alloc_step += step

    return {
        "note_id":         note_id,
        "note_type":       note_type,
        "underlier":       underlier,
        "protection_type": protection_type,
        "protection_pct":  round(protection_pct, 1),
        "alloc_pct":       alloc_pct,
        "base_weights":    base_weights,
        "after_weights":   after_weights,
        "base_metrics": {
            "mean":                round(base_m["mean"] * 100,        2),
            "sharpe":              round(base_m["sharpe"],             4),
            "pct_neg":             round(base_m["pct_neg"],            2),
            "shorty":              round(base_m["shorty"],             4),
            "downside_kurt":       round(base_m["downside_kurt"],      4),
            "expected_income_pct": round(base_m["expected_income_pct"], 2),
        },
        "after_metrics": {
            "mean":                round(after_m["mean"] * 100,   2),
            "sharpe":              round(after_m["sharpe"],        4),
            "pct_neg":             round(after_m["pct_neg"],       2),
            "shorty":              round(after_m["shorty"],        4),
            "downside_kurt":       round(after_m["downside_kurt"], 4),
            "expected_income_pct": round(after_inc,             2),
        },
        "alloc_curve":     alloc_curve,
        "histogram": json.loads(fig.to_json()),
    }


# ── Efficient frontier ─────────────────────────────────────────────────────────

@app.get("/efficient-frontier")
def get_efficient_frontier(outlook: str = "Neutral"):
    """Return mean vs std for all base portfolios and note candidates at horizon=2."""
    _require_data()
    horizon = 2
    h_key   = str(horizon)

    base_points: list[dict] = []
    note_points: list[dict] = []

    note_col_map  = SESSION["note_col_map"]
    note_meta     = SESSION["note_meta"]
    suggestions   = SESSION.get("note_suggestions", {})
    asset_buckets = SESSION["asset_buckets"]

    for port_name, precalc_port in SESSION.get("precalc", {}).items():
        port     = SESSION["portfolios"].get(port_name)
        if not port:
            continue
        weights   = port["weights"]
        risk_free = port.get("risk_free", 2.0)
        asset_cols = list(weights.keys())

        # Base point
        base_m = precalc_port.get("_base", {}).get(h_key)
        if base_m and "mean" in base_m and "std" in base_m:
            base_points.append({
                "portfolio": port_name,
                "mean": round(base_m["mean"] * 100, 2),
                "std":  round(base_m["std"] * 100, 2),
            })

        # Note candidates — need to recompute mean & std
        candidates = precalc_port.get(outlook, {}).get(h_key, [])
        if not candidates:
            continue

        # Compute cumulative returns once for this portfolio
        all_note_cols = [note_col_map[nid] for nid in SESSION["note_ids"] if nid in note_col_map]
        all_cols      = asset_cols + all_note_cols
        col_idx       = SESSION["sim_col_idx"]
        wealth        = _cum_returns(all_cols, horizon)
        asset_arr     = wealth[:, :len(asset_cols)]

        # Bucket info for weight adjustments
        out_bkts_cfg   = (SESSION.get("framework_config") or _default_framework_config())["outlook_buckets"]
        allowed_bkts   = set(out_bkts_cfg.get(outlook, []))
        bucket_assets  = [a for a, b in asset_buckets.items() if b in allowed_bkts and a in weights]
        bucket_total   = sum(weights[a] for a in bucket_assets) if bucket_assets else 0.0

        for cand in candidates:
            nid      = cand["note_id"]
            note_col = note_col_map.get(nid)
            if note_col is None or note_col not in col_idx:
                continue
            alloc_r = cand["alloc_pct"]  # fraction

            # Compute portfolio returns with this note
            note_ci  = all_cols.index(note_col)
            note_arr = wealth[:, note_ci]
            if bucket_total > 0 and bucket_assets:
                new_w = np.array([
                    weights[a] - (weights[a] / bucket_total) * alloc_r if a in bucket_assets else weights[a]
                    for a in asset_cols
                ])
            else:
                new_w = np.array([weights[a] for a in asset_cols])
            port_ret = asset_arr @ new_w + note_arr * alloc_r
            m        = compute_metrics(port_ret, risk_free, horizon)

            ext = suggestions.get(nid, {})
            note_points.append({
                "portfolio":  port_name,
                "note_id":    nid,
                "note_type":  cand["note_type"],
                "underlier":  ext.get("underlier", nid) or nid,
                "alloc_pct":  round(alloc_r * 100, 1),
                "mean":       round(m["mean"] * 100, 2),
                "std":        round(m["std"] * 100, 2),
            })

    # ── Compute note-enhanced efficient frontier ──
    # From all note_points, find the Pareto-optimal set:
    # points where no other point has higher mean AND lower std.
    # Then sort by std to form the frontier line.
    note_frontier: list[dict] = []
    if note_points:
        # Sort by std ascending
        sorted_pts = sorted(note_points, key=lambda p: p["std"])
        # Sweep: keep points where mean is higher than any previous frontier point
        max_mean = float("-inf")
        for pt in sorted_pts:
            if pt["mean"] > max_mean:
                note_frontier.append(pt)
                max_mean = pt["mean"]

    return {
        "base_points": base_points,
        "note_points": note_points,
        "note_frontier": note_frontier,
    }


# ── Export CSV ────────────────────────────────────────────────────────────────

@app.get("/export/csv")
def export_csv():
    imps = SESSION.get("improvements")
    if not imps:
        raise HTTPException(400, "No improvements to export.")
    rows = [{k: v for k, v in r.items() if k != "port_returns"} for r in imps]
    df_out = pd.DataFrame(rows)
    buf = io.StringIO()
    df_out.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        io.BytesIO(buf.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=improvements.csv"},
    )


# ── Export PDF ────────────────────────────────────────────────────────────────

@app.get("/export/pdf")
def export_pdf():
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.units import inch
    from reportlab.lib import colors
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage,
    )
    from reportlab.lib.styles import getSampleStyleSheet
    import plotly.io as pio
    import tempfile, os

    imps = SESSION.get("improvements")
    meta = SESSION.get("improvements_meta")
    if not imps or not meta:
        raise HTTPException(400, "No results to export.")

    fw = meta["framework"]
    bm = meta["base_metrics"]
    base_ret = np.array(meta["base_returns"])

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter,
                             leftMargin=0.75*inch, rightMargin=0.75*inch,
                             topMargin=0.75*inch, bottomMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story  = []

    # Title
    story.append(Paragraph("Portfolio Improvement Report", styles["Title"]))
    story.append(Spacer(1, 12))

    # Framework reminder
    story.append(Paragraph(
        f"<b>Framework:</b> Outlook={fw['outlook']} | Risk={fw['risk_tolerance']} | "
        f"Goal={fw['goal']} | Horizon={fw['horizon']}yr | RFR={fw['risk_free']}%",
        styles["Normal"]
    ))
    story.append(Spacer(1, 8))

    # Base summary
    story.append(Paragraph("<b>Base Portfolio Summary</b>", styles["Heading2"]))
    base_data = [
        ["Sharpe", "% Negative", "Shorty (Ex. Kurt.)", "D. Kurt.", "Expected Income %"],
        [
            f"{bm['sharpe']:.4f}",
            f"{bm['pct_neg']:.2f}%",
            f"{bm['shorty']:.4f}",
            f"{bm.get('downside_kurt', 0):.4f}",
            f"{bm['expected_income_pct']:.2f}%",
        ]
    ]
    t = Table(base_data, colWidths=[1.3*inch]*5)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.darkblue),
        ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
        ("GRID",       (0,0), (-1,-1), 0.5, colors.grey),
        ("ALIGN",      (0,0), (-1,-1), "CENTER"),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ]))
    story.append(t)
    story.append(Spacer(1, 16))

    # Improvements table
    story.append(Paragraph("<b>Top Improvement Candidates</b>", styles["Heading2"]))
    headers = ["Note ID", "Type", "Alloc %", "New Sharpe", "New %Neg", "New Shorty", "New D.Kurt", "Inc Boost", "Score"]
    imp_rows = [headers]
    for r in imps:
        imp_rows.append([
            r["note_id"], r["note_type"], f"{r['alloc_pct']}%",
            f"{r['new_sharpe']:.4f}", f"{r['new_pct_neg']:.2f}%",
            f"{r['new_shorty']:.4f}", f"{r.get('new_downside_kurt', 0):.4f}",
            f"{r['income_boost']:.4f}",
            f"{r['score']:.4f}",
        ])
    col_w = [0.8*inch, 0.65*inch, 0.55*inch, 0.75*inch, 0.65*inch, 0.75*inch, 0.7*inch, 0.7*inch, 0.65*inch]
    t2 = Table(imp_rows, colWidths=col_w)
    t2.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.steelblue),
        ("TEXTCOLOR",  (0,0), (-1,0), colors.white),
        ("GRID",       (0,0), (-1,-1), 0.5, colors.lightgrey),
        ("ALIGN",      (0,0), (-1,-1), "CENTER"),
        ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE",   (0,0), (-1,-1), 8),
    ]))
    story.append(t2)
    story.append(Spacer(1, 16))

    # Histograms
    story.append(Paragraph("<b>Return Distribution Overlays</b>", styles["Heading2"]))
    tmp_files = []

    for idx, r in enumerate(imps):
        cand_ret = np.array(r["port_returns"])
        fig = go.Figure()
        fig.add_trace(go.Histogram(
            x=base_ret * 100, name="Base Portfolio",
            opacity=0.75, marker_color="steelblue",
            histnorm="probability density", nbinsx=80,
        ))
        fig.add_trace(go.Histogram(
            x=cand_ret * 100, name=f"Note {r['note_id']} @ {r['alloc_pct']}%",
            opacity=0.55, marker_color="darkorange",
            histnorm="probability density", nbinsx=80,
        ))
        fig.add_vline(x=0, line_dash="dash", line_color="red")
        fig.update_layout(
            barmode="overlay",
            title=f"Note {r['note_id']} @ {r['alloc_pct']}%",
            xaxis_title="Final Cumulative Return (%)",
            yaxis_title="Density",
            template="plotly_white",
            height=350, width=680,
        )
        try:
            tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            pio.write_image(fig, tmp.name, format="png", scale=1.5)
            tmp.close()
            story.append(RLImage(tmp.name, width=6.5*inch, height=3.3*inch))
            story.append(Spacer(1, 8))
            tmp_files.append(tmp.name)
        except Exception:
            story.append(Paragraph(
                f"[Histogram for Note {r['note_id']} could not be rendered]",
                styles["Normal"]
            ))

    doc.build(story)
    buf.seek(0)

    for f in tmp_files:
        try:
            os.unlink(f)
        except Exception:
            pass

    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=portfolio_report.pdf"},
    )


# ── Dev helper: load test file from disk ─────────────────────────────────────

@app.post("/dev/load-test-file")
async def dev_load_test_file(path: str = "../Test2.xlsx"):
    """Development helper — loads a file from the server's filesystem."""
    abs_path = os.path.abspath(os.path.join(os.path.dirname(__file__), path))
    if not os.path.exists(abs_path):
        raise HTTPException(404, f"File not found: {abs_path}")
    with open(abs_path, "rb") as f:
        contents = f.read()
    result = _parse_and_load_xlsx(contents, os.path.basename(abs_path))
    # Also persist so future restarts auto-load this file
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(UPLOAD_PATH, "wb") as f:
        f.write(contents)
    return {k: result[k] for k in ("asset_cols", "note_ids", "row_count")}


# ── Portfolio summary (pre-framework overview) ────────────────────────────────

@app.get("/portfolio-summary")
def portfolio_summary(horizon: int = 1, risk_free: float = 2.0):
    """Return allocation breakdown + base metrics for every saved portfolio."""
    _require_data()
    if not SESSION["portfolios"]:
        raise HTTPException(400, "No portfolios saved yet.")
    if not SESSION["asset_buckets"]:
        raise HTTPException(400, "Asset metadata not set. Complete step 3 first.")
    if horizon not in (1, 2, 3):
        raise HTTPException(400, "Horizon must be 1, 2, or 3.")

    result = []
    for name, port in SESSION["portfolios"].items():
        weights    = port["weights"]
        asset_cols = list(weights.keys())

        cum_arr   = _cum_returns(asset_cols, horizon)
        w_arr     = np.array([weights[a] for a in asset_cols])
        final_ret = cum_arr @ w_arr
        metrics   = compute_metrics(final_ret, risk_free, horizon)
        inc_pct   = expected_income(weights, SESSION["asset_yields"])

        # Build allocation rows sorted descending by weight
        allocations = sorted(
            [{"asset": a, "weight_pct": round(w * 100, 2)} for a, w in weights.items()],
            key=lambda x: -x["weight_pct"],
        )

        result.append({
            "name":                name,
            "allocations":         allocations,
            "sharpe":              round(metrics["sharpe"],        4),
            "pct_neg":             round(metrics["pct_neg"],       4),
            "shorty":              round(metrics["shorty"],        4),
            "downside_kurt":       round(metrics["downside_kurt"], 4),
            "expected_income_pct": round(inc_pct,                  4),
            "mean":                round(metrics["mean"],          4),
            "std":                 round(metrics["std"],           4),
        })

    # Also return classified notes for display
    notes = [
        {
            "note_id":   nid,
            "note_type": meta.get("type",      ""),
            "yield_pct": meta.get("yield_pct", 0.0),
        }
        for nid, meta in SESSION["note_meta"].items()
    ]

    return {"portfolios": result, "notes": notes, "horizon": horizon, "risk_free": risk_free}


# ── Portfolio candidates (pre-framework, all note × alloc combos) ─────────────

@app.get("/portfolio-candidates")
def portfolio_candidates(risk_free: float = 2.0):
    """
    For each saved portfolio, return base metrics and every note × alloc combo
    at ALL THREE horizons (1yr, 2yr, 3yr) in a single call.
    Each candidate also includes the complete portfolio weight breakdown.
    """
    _require_data()
    if not SESSION["portfolios"]:
        raise HTTPException(400, "No portfolios saved yet.")
    if not SESSION["asset_buckets"]:
        raise HTTPException(400, "Asset metadata not set. Complete step 3 first.")
    if not SESSION["note_meta"]:
        raise HTTPException(400, "Notes not classified yet. Complete step 2 first.")

    all_asset_cols = SESSION["asset_cols"]
    note_col_map   = SESSION["note_col_map"]
    note_meta      = SESSION["note_meta"]
    asset_yields   = SESSION["asset_yields"]

    raw        = SESSION["sim_data"]
    col_idx    = SESSION["sim_col_idx"]
    alloc_steps = [round(i * 0.05, 2) for i in range(1, 9)]  # 0.05 … 0.40

    def _metrics(ret_vec, rfr, note_type, note_yield_frac, alloc, new_weights, a_cols, horizon, is_income=False):
        m          = compute_metrics(ret_vec, rfr, horizon)
        new_income = sum(new_weights.get(a, 0.0) * asset_yields.get(a, 0.0) for a in a_cols)
        if is_income:
            new_income += alloc * note_yield_frac * 100
        return {
            "sharpe":               round(m["sharpe"],        4),
            "pct_neg":              round(m["pct_neg"],       4),
            "shorty":               round(m["shorty"],        4),
            "downside_kurt":        round(m["downside_kurt"], 4),
            "expected_income_pct":  round(new_income,         4),
            "mean":                 round(m["mean"],          4),
            "std":                  round(m["std"],           4),
        }

    result = []
    for port_name, port in SESSION["portfolios"].items():
        weights    = port["weights"]
        asset_cols = list(weights.keys())
        port_rfr   = port.get("risk_free", risk_free)
        w_arr      = np.array([weights[a] for a in asset_cols])
        asset_idx  = [col_idx[a] for a in asset_cols]

        # Base metrics — one horizon at a time (asset cols only ≈ 1MB each)
        base_income = expected_income(weights, asset_yields)
        base_h: dict[str, dict] = {}
        for h in (1, 2, 3):
            asset_sub = np.ascontiguousarray(raw[:, :h, :][:, :, asset_idx]).astype(np.float64)
            asset_arr = np.prod(1 + asset_sub, axis=1) - 1
            base_ret  = asset_arr @ w_arr
            bm        = compute_metrics(base_ret, port_rfr, h)
            base_h[f"h{h}"] = {
                "sharpe":               round(bm["sharpe"],        4),
                "pct_neg":              round(bm["pct_neg"],       4),
                "shorty":               round(bm["shorty"],        4),
                "downside_kurt":        round(bm["downside_kurt"], 4),
                "expected_income_pct":  round(base_income,         4),
                "mean":                 round(bm["mean"],          4),
                "std":                  round(bm["std"],           4),
            }

        allocations = sorted(
            [{"asset": a, "weight_pct": round(w * 100, 2)} for a, w in weights.items()],
            key=lambda x: -x["weight_pct"],
        )

        # Candidates: process one horizon at a time to avoid holding all 3 in memory
        # Build per-note, per-alloc skeleton first, then fill horizon metrics
        note_rows = []
        for note_id, meta in note_meta.items():
            note_col = note_col_map.get(note_id)
            if note_col is None or note_col not in col_idx:
                continue
            note_type   = meta.get("type", "")
            note_income = meta.get("income_eligible", note_type in NOTE_TYPES_INCOME)
            note_yield  = meta.get("yield_pct", 0.0) / 100.0 if note_income else 0.0
            n_ci        = col_idx[note_col]

            candidates = []
            for alloc in alloc_steps:
                new_weights = {a: w * (1.0 - alloc) for a, w in weights.items()}
                full_weights = {a: round(new_weights[a] * 100, 2) for a in asset_cols}
                full_weights[f"NOTE:{note_id}"] = int(round(alloc * 100))
                candidates.append({
                    "alloc_pct": int(round(alloc * 100)),
                    "weights":   full_weights,
                    "_nw":       new_weights,  # temporary, removed before response
                })

            note_rows.append({
                "note_id":     note_id,
                "note_type":   note_type,
                "yield_pct":   meta.get("yield_pct", 0.0),
                "candidates":  candidates,
                "_note_yield": note_yield,
                "_is_income":  note_income,
                "_n_ci":       n_ci,
            })

        # Fill horizon metrics one horizon at a time
        for h in (1, 2, 3):
            asset_sub = np.ascontiguousarray(raw[:, :h, :][:, :, asset_idx]).astype(np.float64)
            asset_arr = np.prod(1 + asset_sub, axis=1) - 1
            del asset_sub

            for nr in note_rows:
                n_ci = nr["_n_ci"]
                note_sub = raw[:, :h, n_ci].astype(np.float64)
                note_arr = np.prod(1 + note_sub, axis=1) - 1 if h > 1 else note_sub.ravel()

                for cand in nr["candidates"]:
                    alloc   = cand["alloc_pct"] / 100.0
                    nw_vec  = np.array([cand["_nw"][a] for a in asset_cols])
                    ret     = asset_arr @ nw_vec + note_arr * alloc
                    cand[f"h{h}"] = _metrics(ret, port_rfr, nr["note_type"], nr["_note_yield"],
                                             alloc, cand["_nw"], asset_cols, h,
                                             is_income=nr["_is_income"])

            del asset_arr

        # Clean up temporary fields
        for nr in note_rows:
            del nr["_note_yield"], nr["_n_ci"]
            for cand in nr["candidates"]:
                del cand["_nw"]

        result.append({
            "name":        port_name,
            "allocations": allocations,
            "base":        base_h,
            "notes":       note_rows,
        })

    return {"portfolios": result, "risk_free": risk_free}


# ── Session state getter ──────────────────────────────────────────────────────

@app.get("/session-state")
def session_state():
    return {
        "has_file":          SESSION["sim_data"] is not None,
        "fingerprint":       SESSION["fingerprint"],
        "asset_cols":        SESSION["asset_cols"],
        "note_ids":          SESSION["note_ids"],
        "note_meta":         SESSION["note_meta"],
        "asset_yields":      SESSION["asset_yields"],
        "asset_buckets":     SESSION["asset_buckets"],
        "portfolios":        list(SESSION["portfolios"].keys()),
        "has_precalc":           bool(SESSION["precalc"]),
        "has_improvements":      bool(SESSION.get("improvements")),
        "note_suggestions":      SESSION.get("note_suggestions", {}),
        "has_framework_config":  bool((SESSION.get("framework_config") or {}).get("cells")),
    }


@app.get("/files")
def list_files():
    """Return all previously uploaded files with their portfolio counts."""
    db = _load_db()
    result = []
    for fp, entry in db.items():
        result.append({
            "fingerprint":     fp,
            "filename":        entry.get("filename", "unknown"),
            "row_count":       entry.get("row_count", 0),
            "asset_cols":      entry.get("asset_cols", []),
            "note_ids":        entry.get("note_ids", []),
            "portfolio_count": len(entry.get("portfolios", {})),
            "portfolio_names": list(entry.get("portfolios", {}).keys()),
            "updated_at":      entry.get("updated_at", ""),
        })
    result.sort(key=lambda x: x["updated_at"], reverse=True)
    return result
