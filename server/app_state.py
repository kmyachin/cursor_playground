from __future__ import annotations

import json
import sqlite3

from utils import utc_now_iso

# Как в client/src/data/mockData.js (child.initialBalance) — база для пустого app_state.
DEFAULT_DEMO_BALANCE = 1250


def normalize_app_state(raw: dict) -> dict:
    base = {
        "balance": DEFAULT_DEMO_BALANCE,
        "extraTransactions": [],
        "settings": {
            "dailyLimit": 500,
            "cardBlocked": False,
            "perTxnLimit": 300,
        },
    }
    if not raw:
        return base
    if isinstance(raw.get("balance"), int):
        base["balance"] = raw["balance"]
    if isinstance(raw.get("extraTransactions"), list):
        base["extraTransactions"] = raw["extraTransactions"]
    st = raw.get("settings")
    if isinstance(st, dict):
        if isinstance(st.get("dailyLimit"), int):
            base["settings"]["dailyLimit"] = st["dailyLimit"]
        base["settings"]["cardBlocked"] = bool(st.get("cardBlocked"))
        if isinstance(st.get("perTxnLimit"), int):
            base["settings"]["perTxnLimit"] = st["perTxnLimit"]
    return base


def upsert_app_state(conn: sqlite3.Connection, client_id: str, app_state: dict) -> None:
    now = utc_now_iso()
    row = conn.execute(
        "SELECT session, extras FROM client_data WHERE client_id = ?",
        (client_id,),
    ).fetchone()
    session_sql = row["session"] if row else None
    extras_json = row["extras"] if row else "{}"
    if not extras_json:
        extras_json = "{}"
    conn.execute(
        """
        INSERT INTO client_data (client_id, app_state, session, extras, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET
            app_state = excluded.app_state,
            updated_at = excluded.updated_at
        """,
        (
            client_id,
            json.dumps(app_state, ensure_ascii=False),
            session_sql,
            extras_json,
            now,
        ),
    )
