from __future__ import annotations

import sqlite3


def fetch_achievement_keys_for_week(
    conn: sqlite3.Connection, client_id: str, week_id: str, limit: int = 5
) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT achievement_key, detail_json, unlocked_at FROM achievement_unlocks
        WHERE client_id = ? AND week_id = ?
        ORDER BY unlocked_at DESC LIMIT ?
        """,
        (client_id, week_id, limit),
    ).fetchall()


def count_pending_savings_ideas(conn: sqlite3.Connection, client_id: str) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS c FROM savings_ideas WHERE client_id = ? AND status = 'pending'",
        (client_id,),
    ).fetchone()
    return int(row["c"])
