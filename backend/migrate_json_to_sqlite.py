"""One-time migration from portfolios_db.json to SQLite.

Called automatically at startup if the JSON file exists.
After migration, the JSON file is renamed to .bak as a safety net.
"""

import json
import os

import db


def migrate() -> None:
    json_path = os.path.join(db.DATA_DIR, "portfolios_db.json")
    if not os.path.exists(json_path):
        print("[migrate] No portfolios_db.json found — nothing to migrate.")
        return

    print(f"[migrate] Found {json_path}, migrating to SQLite...")
    with open(json_path) as f:
        data = json.load(f)

    db.init_db()

    # Migrate framework_config (top-level key, not a fingerprint)
    framework_config = data.pop("framework_config", None)
    if framework_config:
        db.save_framework_config(framework_config)
        print("[migrate] Migrated framework_config.")

    # Migrate file sessions (all remaining keys are fingerprints)
    count = 0
    for fp, entry in data.items():
        if not isinstance(entry, dict):
            print(f"[migrate] Skipping non-dict key: {fp}")
            continue
        db.save_session(fp, {
            "filename":      entry.get("filename", "unknown"),
            "row_count":     entry.get("row_count", 0),
            "asset_cols":    entry.get("asset_cols", []),
            "note_ids":      entry.get("note_ids", []),
            "note_meta":     entry.get("note_meta", {}),
            "asset_yields":  entry.get("asset_yields", {}),
            "asset_buckets": entry.get("asset_buckets", {}),
            "portfolios":    entry.get("portfolios", {}),
            "precalc":       entry.get("precalc", {}),
            "created_at":    entry.get("created_at", ""),
            "updated_at":    entry.get("updated_at", ""),
        })
        count += 1
        print(f"[migrate]   {fp}: {entry.get('filename', '?')} "
              f"({len(entry.get('portfolios', {}))} portfolios)")

    # Rename JSON to .bak
    bak_path = json_path + ".bak"
    os.rename(json_path, bak_path)
    print(f"[migrate] Done — migrated {count} file sessions. "
          f"JSON renamed to {bak_path}")


if __name__ == "__main__":
    db.init_db()
    migrate()
