from __future__ import annotations

import sqlite3


def count_history_views_in_week(
    conn: sqlite3.Connection, client_id: str, week_id: str
) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS c FROM engagement_log
        WHERE client_id = ? AND week_id = ? AND event_type = ?
        """,
        (client_id, week_id, "history_view"),
    ).fetchone()
    return int(row["c"])
