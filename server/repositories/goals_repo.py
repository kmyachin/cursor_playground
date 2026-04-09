from __future__ import annotations

import sqlite3


def fetch_goals_for_client_ordered(
    conn: sqlite3.Connection, client_id: str
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM goals WHERE client_id = ? ORDER BY created_at DESC",
        (client_id,),
    ).fetchall()


def fetch_active_goals_ordered(
    conn: sqlite3.Connection, client_id: str
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT * FROM goals WHERE client_id = ? AND active = 1 ORDER BY created_at DESC",
        (client_id,),
    ).fetchall()


def fetch_goal_by_id(
    conn: sqlite3.Connection, goal_id: str, client_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT * FROM goals WHERE id = ? AND client_id = ?",
        (goal_id, client_id),
    ).fetchone()


def sum_contributions_for_goal(conn: sqlite3.Connection, goal_id: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(SUM(amount), 0) AS s FROM goal_contributions WHERE goal_id = ?",
        (goal_id,),
    ).fetchone()
    return int(row["s"])


def fetch_contributions_ordered_desc(
    conn: sqlite3.Connection, goal_id: str
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT id, amount, contributed_at FROM goal_contributions WHERE goal_id = ? ORDER BY contributed_at DESC",
        (goal_id,),
    ).fetchall()


def fetch_contribution_amounts_for_goal(
    conn: sqlite3.Connection, goal_id: str
) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT amount, contributed_at FROM goal_contributions WHERE goal_id = ?",
        (goal_id,),
    ).fetchall()


def insert_goal(
    conn: sqlite3.Connection,
    goal_id: str,
    client_id: str,
    title: str,
    target: int,
    deadline_iso: str,
    weekly_amount: int,
    num_weeks: int,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO goals (id, client_id, title, target_amount, deadline, weekly_amount, num_weeks, created_at, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        """,
        (
            goal_id,
            client_id,
            title,
            target,
            deadline_iso,
            weekly_amount,
            num_weeks,
            created_at,
        ),
    )


def insert_goal_contribution(
    conn: sqlite3.Connection,
    contribution_id: str,
    goal_id: str,
    amount: int,
    contributed_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO goal_contributions (id, goal_id, amount, contributed_at)
        VALUES (?, ?, ?, ?)
        """,
        (contribution_id, goal_id, amount, contributed_at),
    )
