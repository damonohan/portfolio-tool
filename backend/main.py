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
    compute_cumulative_returns,
    compute_metrics,
    expected_income,
    find_improvements,
    portfolio_returns,
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
    """Load framework_config from DB top-level key into SESSION."""
    db = _load_db()
    saved = db.get("framework_config")
    if saved and saved.get("cells"):
        SESSION["framework_config"] = saved
    else:
        SESSION["framework_config"] = _default_framework_config()


# ── In-memory session store ───────────────────────────────────────────────────

SESSION: dict[str, Any] = {
    "df":                None,
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


def _require_df() -> pd.DataFrame:
    if SESSION["df"] is None:
        raise HTTPException(400, "No file uploaded yet.")
    return SESSION["df"]


# ── Framework config helpers ──────────────────────────────────────────────────

_OUTLOOKS       = ("Bullish", "Neutral", "Bearish")
_RISKS          = ("Conservative", "Moderate", "Aggressive")
_GOALS          = ("Growth", "Balanced", "Income")
_MAX_ALLOC      = 30.0   # flat max allocation for every cell

_DEFAULT_TYPES: dict[str, list[str]] = {
    "Bullish": ["Growth", "Digital", "Absolute"],
    "Neutral": ["Growth", "Digital", "Absolute", "Income", "MLCD", "PPN"],
    "Bearish": ["Income", "MLCD", "PPN", "Absolute"],
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
    df = SESSION["df"]
    if df is None:
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

    # Pre-compute cumulative returns for all 3 horizons (string keys for JSON safety)
    cum = {str(h): compute_cumulative_returns(df, all_cols, h) for h in (1, 2, 3)}

    result: dict[str, Any] = {
        "_base":   {},
        "Bullish": {},
        "Bearish": {},
        "Neutral": {},
    }

    # Asset yields as fractions for income_boost calculation
    asset_yields_frac = {a: y / 100.0 for a, y in asset_yields.items()}

    # Base metrics for 3 horizons
    for h in (1, 2, 3):
        base_ret = portfolio_returns(cum[str(h)], weights)
        m        = compute_metrics(base_ret, risk_free, h)
        inc_pct  = expected_income(weights, asset_yields)
        result["_base"][str(h)] = {
            "sharpe":               round(m["sharpe"],  4),
            "pct_neg":              round(m["pct_neg"], 4),
            "shorty":               round(m["shorty"],  4),
            "mean":                 round(m["mean"],    4),
            "std":                  round(m["std"],     4),
            "expected_income_pct":  round(inc_pct,      4),
        }

    # Candidates per outlook per horizon — uses framework_config for bucket selection;
    # NO note-type filtering here: all notes computed, filtering applied at ranking time.
    fw_cfg      = SESSION.get("framework_config") or _default_framework_config()
    out_buckets = fw_cfg.get("outlook_buckets", _default_framework_config()["outlook_buckets"])
    global_max  = 0.40   # compute up to 40%; per-cell cap applied client-side / at ranking time

    for outlook in ("Bullish", "Bearish", "Neutral"):
        allowed_buckets = set(out_buckets.get(outlook, []))

        # Bucket assets eligible for reduction under this outlook
        bucket_assets = [a for a, b in asset_buckets.items() if b in allowed_buckets and a in weights]
        bucket_total  = sum(weights[a] for a in bucket_assets)

        for h in (1, 2, 3):
            if bucket_total <= 0:
                result[outlook][str(h)] = []
                continue

            base_m    = result["_base"][str(h)]
            base_inc  = base_m["expected_income_pct"] / 100.0  # convert to fraction
            cd        = cum[str(h)]
            candidates: list[dict] = []

            for note_id in note_ids:
                note_col = note_col_map.get(note_id)
                if note_col is None:
                    continue
                meta      = note_meta.get(note_id, {})
                # Extended fields (underlier, protection_type, protection_pct) live in
                # note_suggestions (parsed from the Notes sheet), NOT in note_meta which
                # only stores the user-editable type + yield_pct.
                ext       = SESSION.get("note_suggestions", {}).get(note_id, {})
                note_type = meta.get("type", "")

                note_yield_frac = meta.get("yield_pct", 0.0) / 100.0 if note_type in NOTE_TYPES_INCOME else 0.0

                step  = 0.05
                alloc = step
                while alloc <= global_max + 1e-9:
                    alloc_r = round(alloc, 4)
                    if alloc_r > bucket_total + 1e-6:
                        alloc += step
                        continue

                    # Pro-rata reduce bucket assets
                    new_weights = dict(weights)
                    for a in bucket_assets:
                        new_weights[a] = weights[a] - (weights[a] / bucket_total) * alloc_r

                    new_asset_w = {a: w for a, w in new_weights.items() if a in asset_cols}

                    asset_ret = cd[asset_cols].values @ np.array([new_asset_w[a] for a in asset_cols])
                    note_ret  = cd[note_col].values * alloc_r
                    port_ret  = asset_ret + note_ret

                    m = compute_metrics(port_ret, risk_free, h)

                    # Income boost (in fraction units to match rank_score)
                    new_income = sum(new_weights.get(a, 0.0) * asset_yields_frac.get(a, 0.0) for a in asset_cols)
                    if note_type in NOTE_TYPES_INCOME:
                        new_income += alloc_r * note_yield_frac
                    income_boost = new_income - base_inc

                    # Acceptance: at least one criterion improves
                    improves = (
                        m["sharpe"]  >= base_m["sharpe"]  or
                        m["pct_neg"] <= base_m["pct_neg"] or
                        m["shorty"]  <= base_m["shorty"]  or
                        (note_type in NOTE_TYPES_INCOME and income_boost > 0)
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
                                "sharpe":       round(m["sharpe"],  4),
                                "pct_neg":      round(m["pct_neg"], 4),
                                "shorty":       round(m["shorty"],  4),
                                "income_boost": round(income_boost, 6),
                            },
                        })

                    alloc += step

            result[outlook][str(h)] = candidates

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
            # Re-run precalc for every restored portfolio so that extended metadata
            # (underlier, protection_type, protection_pct) from the Notes sheet is
            # picked up correctly — fixes any stale candidates that had protection_pct=0.0
            for name in list(SESSION.get("portfolios", {}).keys()):
                try:
                    _run_precalc(name)
                except Exception:
                    pass
            if SESSION.get("portfolios"):
                _db_save_session(SESSION["fingerprint"])
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

    SESSION["df"]                = df
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

    # ── Auto-classify notes if Tracking sheet covered every note ID ──────────
    auto_classified = False
    if (
        note_suggestions
        and set(note_suggestions.keys()) == set(note_ids)
        and not SESSION["note_meta"]   # don't overwrite a restored DB entry
    ):
        SESSION["note_meta"] = {
            nid: {
                "type":      s["type"],
                "yield_pct": s["yield_pct"] if s["type"] == "Income" else 0.0,
            }
            for nid, s in note_suggestions.items()
            if s.get("type") in VALID_TYPES  # only apply valid types
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
    note_id:   str
    note_type: str
    yield_pct: float = 0.0


class ClassifyRequest(BaseModel):
    classifications: list[NoteClassification]


VALID_TYPES = {"Income", "Growth", "Digital", "Absolute", "MLCD", "PPN"}


@app.post("/classify-notes")
def classify_notes(req: ClassifyRequest):
    _require_df()
    meta: dict[str, dict] = {}
    for c in req.classifications:
        if c.note_type not in VALID_TYPES:
            raise HTTPException(400, f"Invalid note type: {c.note_type}")
        if c.note_id not in SESSION["note_ids"]:
            raise HTTPException(400, f"Unknown note ID: {c.note_id}")
        meta[c.note_id] = {
            "type":      c.note_type,
            "yield_pct": c.yield_pct if c.note_type == "Income" else 0.0,
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
    _require_df()
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
    _require_df()
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
    _require_df()
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
    _require_df()
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
    # Re-run precalc for all saved portfolios since eligibility rules changed
    if SESSION["df"] is not None and SESSION["portfolios"] and SESSION["asset_buckets"]:
        for name in list(SESSION["portfolios"].keys()):
            _run_precalc(name)
        _db_save_session(SESSION["fingerprint"])
    return {"ok": True}


@app.post("/framework-config/reset")
def reset_framework_config():
    """Reset framework config to built-in defaults and re-run precalc."""
    SESSION["framework_config"] = _default_framework_config()
    _db_save_framework_config()
    if SESSION["df"] is not None and SESSION["portfolios"] and SESSION["asset_buckets"]:
        for name in list(SESSION["portfolios"].keys()):
            _run_precalc(name)
        _db_save_session(SESSION["fingerprint"])
    return {"ok": True, "config": SESSION["framework_config"]}


# ── Improvement search ────────────────────────────────────────────────────────

class FindImprovementsRequest(BaseModel):
    portfolio_name: str
    outlook:        str
    risk_tolerance: str
    goal:           str
    horizon:        int   # 1, 2, or 3


@app.post("/find-improvements")
def find_improvements_endpoint(req: FindImprovementsRequest):
    df = _require_df()
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
                "sharpe":               round(base_m["sharpe"],  4),
                "pct_neg":              round(base_m["pct_neg"], 4),
                "shorty":               round(base_m["shorty"],  4),
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
    cum_df        = compute_cumulative_returns(df, all_cols, req.horizon)

    # Base returns for histogram
    base_ret = portfolio_returns(cum_df, weights)

    results: list[dict] = []
    for c in top5:
        note_id   = c["note_id"]
        note_col  = note_col_map.get(note_id)
        if note_col is None:
            continue
        alloc_r   = c["alloc_pct"]  # fraction

        if bucket_total > 0 and bucket_assets:
            new_weights = dict(weights)
            for a in bucket_assets:
                new_weights[a] = weights[a] - (weights[a] / bucket_total) * alloc_r
        else:
            new_weights = dict(weights)

        new_asset_w = {a: w for a, w in new_weights.items() if a in asset_cols}
        asset_ret   = cum_df[asset_cols].values @ np.array([new_asset_w[a] for a in asset_cols])
        port_ret    = asset_ret + cum_df[note_col].values * alloc_r

        m           = c["metrics"]
        income_boost = m["income_boost"]

        results.append({
            "note_id":      note_id,
            "note_type":    c["note_type"],
            "alloc_pct":    round(alloc_r * 100, 1),   # convert to % for response
            "new_sharpe":   round(m["sharpe"],  4),
            "new_pct_neg":  round(m["pct_neg"], 4),
            "new_shorty":   round(m["shorty"],  4),
            "income_boost": round(income_boost, 4),
            "score":        round(c["score"],   6),
            "port_returns": port_ret.tolist(),
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
            "sharpe":               round(base_m["sharpe"],  4),
            "pct_neg":              round(base_m["pct_neg"], 4),
            "shorty":               round(base_m["shorty"],  4),
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
        ["Sharpe", "% Negative", "Shorty (Ex. Kurtosis)", "Expected Income %"],
        [
            f"{bm['sharpe']:.4f}",
            f"{bm['pct_neg']:.2f}%",
            f"{bm['shorty']:.4f}",
            f"{bm['expected_income_pct']:.2f}%",
        ]
    ]
    t = Table(base_data, colWidths=[1.5*inch]*4)
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
    headers = ["Note ID", "Type", "Alloc %", "New Sharpe", "New %Neg", "New Shorty", "Income Boost", "Score"]
    imp_rows = [headers]
    for r in imps:
        imp_rows.append([
            r["note_id"], r["note_type"], f"{r['alloc_pct']}%",
            f"{r['new_sharpe']:.4f}", f"{r['new_pct_neg']:.2f}%",
            f"{r['new_shorty']:.4f}", f"{r['income_boost']:.4f}",
            f"{r['score']:.4f}",
        ])
    col_w = [0.9*inch, 0.75*inch, 0.65*inch, 0.85*inch, 0.75*inch, 0.85*inch, 0.9*inch, 0.75*inch]
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
    df = _require_df()
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

        cum_df    = compute_cumulative_returns(df, asset_cols, horizon)
        final_ret = portfolio_returns(cum_df, weights)
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
            "sharpe":              round(metrics["sharpe"],   4),
            "pct_neg":             round(metrics["pct_neg"],  4),
            "shorty":              round(metrics["shorty"],   4),
            "expected_income_pct": round(inc_pct,             4),
            "mean":                round(metrics["mean"],     4),
            "std":                 round(metrics["std"],      4),
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
    df = _require_df()
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

    note_cols = list(note_col_map.values())
    all_cols  = all_asset_cols + note_cols

    # Pre-compute cumulative returns for all 3 horizons at once
    cum = {h: compute_cumulative_returns(df, all_cols, h) for h in (1, 2, 3)}

    def _m(cum_df, ret_vec, risk_free, note_type, note_yield_frac, alloc, new_weights, a_cols, horizon=1):
        """Compute metrics dict for one horizon."""
        m          = compute_metrics(ret_vec, risk_free, horizon)
        new_income = sum(new_weights.get(a, 0.0) * asset_yields.get(a, 0.0) for a in a_cols)
        if note_type == "Income":
            new_income += alloc * note_yield_frac * 100
        return {
            "sharpe":               round(m["sharpe"],  4),
            "pct_neg":              round(m["pct_neg"], 4),
            "shorty":               round(m["shorty"],  4),
            "expected_income_pct":  round(new_income,   4),
            "mean":                 round(m["mean"],    4),
            "std":                  round(m["std"],     4),
        }

    alloc_steps = [round(i * 0.05, 2) for i in range(1, 9)]  # 0.05 … 0.40

    result = []
    for port_name, port in SESSION["portfolios"].items():
        weights    = port["weights"]
        asset_cols = list(weights.keys())
        port_rfr   = port.get("risk_free", risk_free)  # use portfolio's own RFR

        # Base metrics for all 3 horizons
        base_income = expected_income(weights, asset_yields)
        base_h: dict[str, dict] = {}
        for h in (1, 2, 3):
            base_ret = portfolio_returns(cum[h], weights)
            bm       = compute_metrics(base_ret, port_rfr, h)
            base_h[f"h{h}"] = {
                "sharpe":               round(bm["sharpe"],  4),
                "pct_neg":              round(bm["pct_neg"], 4),
                "shorty":               round(bm["shorty"],  4),
                "expected_income_pct":  round(base_income,   4),
                "mean":                 round(bm["mean"],    4),
                "std":                  round(bm["std"],     4),
            }

        allocations = sorted(
            [{"asset": a, "weight_pct": round(w * 100, 2)} for a, w in weights.items()],
            key=lambda x: -x["weight_pct"],
        )

        note_rows = []
        for note_id, meta in note_meta.items():
            note_col   = note_col_map.get(note_id)
            if note_col is None:
                continue
            note_type  = meta.get("type", "")
            note_yield = meta.get("yield_pct", 0.0) / 100.0

            candidates = []
            for alloc in alloc_steps:
                new_weights = {a: w * (1.0 - alloc) for a, w in weights.items()}
                nw_vec      = np.array([new_weights[a] for a in asset_cols])

                # Complete portfolio weights (assets + note), all in %
                full_weights = {a: round(new_weights[a] * 100, 2) for a in asset_cols}
                full_weights[f"NOTE:{note_id}"] = int(round(alloc * 100))

                cand: dict = {
                    "alloc_pct":    int(round(alloc * 100)),
                    "weights":      full_weights,
                }
                for h in (1, 2, 3):
                    cd   = cum[h]
                    ret  = cd[asset_cols].values @ nw_vec + cd[note_col].values * alloc
                    cand[f"h{h}"] = _m(cd, ret, port_rfr, note_type, note_yield,
                                       alloc, new_weights, asset_cols, h)
                candidates.append(cand)

            note_rows.append({
                "note_id":    note_id,
                "note_type":  note_type,
                "yield_pct":  meta.get("yield_pct", 0.0),
                "candidates": candidates,
            })

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
        "has_file":          SESSION["df"] is not None,
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
