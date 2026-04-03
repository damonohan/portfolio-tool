"""SQLite persistence layer for portfolio tool.

Replaces the previous portfolios_db.json approach with a proper database.
Uses JSON columns for complex nested data (precalc, portfolios, note_meta)
since they are always read/written as whole units.
"""

import json
import os
import sqlite3
from datetime import datetime, timezone
from typing import Any

DATA_DIR = os.environ.get("DATA_DIR", os.path.dirname(__file__))
SQLITE_PATH = os.path.join(DATA_DIR, "portfolios.db")

_conn: sqlite3.Connection | None = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(SQLITE_PATH, check_same_thread=False)
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS global_config (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS file_sessions (
            fingerprint   TEXT PRIMARY KEY,
            filename      TEXT NOT NULL,
            row_count     INTEGER NOT NULL DEFAULT 0,
            asset_cols    TEXT NOT NULL DEFAULT '[]',
            note_ids      TEXT NOT NULL DEFAULT '[]',
            note_meta     TEXT NOT NULL DEFAULT '{}',
            asset_yields  TEXT NOT NULL DEFAULT '{}',
            asset_buckets TEXT NOT NULL DEFAULT '{}',
            portfolios    TEXT NOT NULL DEFAULT '{}',
            precalc       TEXT NOT NULL DEFAULT '{}',
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );
    """)
    conn.commit()


# ── Framework config ────────────────────────────────────────────────────

def load_framework_config() -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT value FROM global_config WHERE key = 'framework_config'"
    ).fetchone()
    if row:
        return json.loads(row["value"])
    return None


def save_framework_config(config: dict) -> None:
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO global_config (key, value, updated_at)
           VALUES ('framework_config', ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (json.dumps(config), now),
    )
    conn.commit()


# ── File sessions ───────────────────────────────────────────────────────

_JSON_COLS = ("asset_cols", "note_ids", "note_meta", "asset_yields",
              "asset_buckets", "portfolios", "precalc")


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for col in _JSON_COLS:
        if col in d and isinstance(d[col], str):
            d[col] = json.loads(d[col])
    return d


def get_session(fingerprint: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT * FROM file_sessions WHERE fingerprint = ?", (fingerprint,)
    ).fetchone()
    if row:
        return _row_to_dict(row)
    return None


def save_session(fingerprint: str, data: dict) -> None:
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO file_sessions
               (fingerprint, filename, row_count, asset_cols, note_ids,
                note_meta, asset_yields, asset_buckets, portfolios, precalc,
                created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(fingerprint) DO UPDATE SET
               filename      = excluded.filename,
               row_count     = excluded.row_count,
               asset_cols    = excluded.asset_cols,
               note_ids      = excluded.note_ids,
               note_meta     = excluded.note_meta,
               asset_yields  = excluded.asset_yields,
               asset_buckets = excluded.asset_buckets,
               portfolios    = excluded.portfolios,
               precalc       = excluded.precalc,
               updated_at    = excluded.updated_at""",
        (
            fingerprint,
            data.get("filename", ""),
            data.get("row_count", 0),
            json.dumps(data.get("asset_cols", [])),
            json.dumps(data.get("note_ids", [])),
            json.dumps(data.get("note_meta", {})),
            json.dumps(data.get("asset_yields", {})),
            json.dumps(data.get("asset_buckets", {})),
            json.dumps(data.get("portfolios", {})),
            json.dumps(data.get("precalc", {})),
            data.get("created_at", now),
            now,
        ),
    )
    conn.commit()


def list_files() -> list[dict]:
    conn = _get_conn()
    rows = conn.execute(
        """SELECT fingerprint, filename, row_count, asset_cols, note_ids,
                  portfolios, updated_at
           FROM file_sessions ORDER BY updated_at DESC"""
    ).fetchall()
    result = []
    for row in rows:
        portfolios = json.loads(row["portfolios"]) if isinstance(row["portfolios"], str) else row["portfolios"]
        result.append({
            "fingerprint":     row["fingerprint"],
            "filename":        row["filename"],
            "row_count":       row["row_count"],
            "asset_cols":      json.loads(row["asset_cols"]) if isinstance(row["asset_cols"], str) else row["asset_cols"],
            "note_ids":        json.loads(row["note_ids"]) if isinstance(row["note_ids"], str) else row["note_ids"],
            "portfolio_count": len(portfolios),
            "portfolio_names": list(portfolios.keys()),
            "updated_at":      row["updated_at"],
        })
    return result


# ── Export / Import (for seeding new instances) ─────────────────────────

def export_all() -> dict:
    """Export entire database as a JSON-serializable dict."""
    conn = _get_conn()
    result: dict[str, Any] = {}

    # Global config
    for row in conn.execute("SELECT key, value FROM global_config").fetchall():
        result[f"__config__{row['key']}"] = json.loads(row["value"])

    # File sessions
    sessions = []
    for row in conn.execute("SELECT * FROM file_sessions").fetchall():
        sessions.append(_row_to_dict(row))
    result["file_sessions"] = sessions

    return result


def import_all(data: dict) -> None:
    """Import data exported by export_all(), replacing all existing data."""
    conn = _get_conn()
    conn.execute("DELETE FROM global_config")
    conn.execute("DELETE FROM file_sessions")

    # Global config
    now = datetime.now(timezone.utc).isoformat()
    for key, value in data.items():
        if key.startswith("__config__"):
            config_key = key[len("__config__"):]
            conn.execute(
                "INSERT INTO global_config (key, value, updated_at) VALUES (?, ?, ?)",
                (config_key, json.dumps(value), now),
            )

    # File sessions
    for session in data.get("file_sessions", []):
        conn.execute(
            """INSERT INTO file_sessions
                   (fingerprint, filename, row_count, asset_cols, note_ids,
                    note_meta, asset_yields, asset_buckets, portfolios, precalc,
                    created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session["fingerprint"],
                session.get("filename", ""),
                session.get("row_count", 0),
                json.dumps(session.get("asset_cols", [])),
                json.dumps(session.get("note_ids", [])),
                json.dumps(session.get("note_meta", {})),
                json.dumps(session.get("asset_yields", {})),
                json.dumps(session.get("asset_buckets", {})),
                json.dumps(session.get("portfolios", {})),
                json.dumps(session.get("precalc", {})),
                session.get("created_at", now),
                session.get("updated_at", now),
            ),
        )

    conn.commit()
