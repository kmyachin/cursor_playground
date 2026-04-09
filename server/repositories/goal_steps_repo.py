from __future__ import annotations

import sqlite3


def fetch_goal_steps_for_client(
    conn: sqlite3.Connection, client_id: str, status_filter: str
) -> list[sqlite3.Row]:
    q = """
        SELECT s.id, s.client_id, s.goal_id, s.title, s.reward_amount, s.status,
               s.created_at, s.done_at, s.resolved_at, s.parent_note,
               s.step_kind,
               g.title AS goal_title
        FROM goal_steps s
        JOIN goals g ON g.id = s.goal_id
        WHERE s.client_id = ?
    """
    args: list = [client_id]
    if status_filter:
        q += " AND s.status = ?"
        args.append(status_filter)
    q += " ORDER BY s.created_at DESC"
    return conn.execute(q, args).fetchall()


def fetch_goal_step(
    conn: sqlite3.Connection, step_id: str, goal_id: str, client_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM goal_steps WHERE id = ? AND goal_id = ? AND client_id = ?
        """,
        (step_id, goal_id, client_id),
    ).fetchone()


def insert_goal_step_open(
    conn: sqlite3.Connection,
    step_id: str,
    client_id: str,
    goal_id: str,
    title: str,
    reward: int,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO goal_steps (id, client_id, goal_id, title, reward_amount, status, created_at, step_kind)
        VALUES (?, ?, ?, ?, ?, 'open', ?, 'custom')
        """,
        (step_id, client_id, goal_id, title, reward, created_at),
    )


def update_step_done_pending(
    conn: sqlite3.Connection, done_at: str, step_id: str
) -> None:
    conn.execute(
        """
        UPDATE goal_steps SET status = 'done_pending', done_at = ?
        WHERE id = ?
        """,
        (done_at, step_id),
    )


def update_step_paid(
    conn: sqlite3.Connection, resolved_at: str, step_id: str
) -> None:
    conn.execute(
        """
        UPDATE goal_steps
        SET status = 'paid', resolved_at = ?, parent_note = NULL
        WHERE id = ?
        """,
        (resolved_at, step_id),
    )


def update_step_rejected(
    conn: sqlite3.Connection,
    resolved_at: str,
    parent_note: str | None,
    step_id: str,
) -> None:
    conn.execute(
        """
        UPDATE goal_steps SET status = 'rejected', resolved_at = ?, parent_note = ?
        WHERE id = ?
        """,
        (resolved_at, parent_note, step_id),
    )
