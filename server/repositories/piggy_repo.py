from __future__ import annotations

import sqlite3


def piggy_bank_id_for_goal(
    conn: sqlite3.Connection, goal_id: str, client_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id FROM piggy_banks WHERE goal_id = ? AND client_id = ?",
        (goal_id, client_id),
    ).fetchone()


def insert_piggy_for_goal(
    conn: sqlite3.Connection,
    bank_id: str,
    client_id: str,
    goal_id: str,
    title: str,
    emoji: str,
    created_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO piggy_banks (id, client_id, goal_id, title, emoji, created_at, standalone_target)
        VALUES (?, ?, ?, ?, ?, ?, NULL)
        """,
        (bank_id, client_id, goal_id, title, emoji, created_at),
    )


def fetch_standalone_piggy_bank(
    conn: sqlite3.Connection, piggy_id: str, client_id: str
) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT * FROM piggy_banks WHERE id = ? AND client_id = ? AND goal_id IS NULL
        """,
        (piggy_id, client_id),
    ).fetchone()


def sum_deposits_for_piggy(conn: sqlite3.Connection, piggy_id: str) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(amount), 0) AS s FROM piggy_bank_deposits
        WHERE piggy_bank_id = ?
        """,
        (piggy_id,),
    ).fetchone()
    return int(row["s"])


def insert_piggy_deposit(
    conn: sqlite3.Connection,
    deposit_id: str,
    piggy_id: str,
    amount: int,
    deposited_at: str,
) -> None:
    conn.execute(
        """
        INSERT INTO piggy_bank_deposits (id, piggy_bank_id, amount, deposited_at)
        VALUES (?, ?, ?, ?)
        """,
        (deposit_id, piggy_id, amount, deposited_at),
    )


def delete_deposits_for_piggy(conn: sqlite3.Connection, piggy_id: str) -> None:
    conn.execute(
        "DELETE FROM piggy_bank_deposits WHERE piggy_bank_id = ?",
        (piggy_id,),
    )


def update_piggy_attach_goal(
    conn: sqlite3.Connection,
    goal_id: str,
    title: str,
    emoji: str,
    piggy_id: str,
    client_id: str,
) -> None:
    conn.execute(
        """
        UPDATE piggy_banks
        SET goal_id = ?, title = ?, emoji = ?, standalone_target = NULL
        WHERE id = ? AND client_id = ?
        """,
        (goal_id, title, emoji, piggy_id, client_id),
    )


def insert_standalone_piggy(
    conn: sqlite3.Connection,
    piggy_id: str,
    client_id: str,
    title: str,
    emoji: str,
    created_at: str,
    standalone_target: int | None,
) -> None:
    conn.execute(
        """
        INSERT INTO piggy_banks (id, client_id, goal_id, title, emoji, created_at, standalone_target)
        VALUES (?, ?, NULL, ?, ?, ?, ?)
        """,
        (piggy_id, client_id, title, emoji, created_at, standalone_target),
    )


def fetch_piggy_banks_with_saved(conn: sqlite3.Connection, client_id: str) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT p.id AS pid, p.goal_id, p.title, p.emoji, p.created_at, p.standalone_target,
               g.id AS gid, g.target_amount, g.deadline, g.active,
               CASE WHEN p.goal_id IS NOT NULL THEN
                 COALESCE(
                   (SELECT SUM(amount) FROM goal_contributions WHERE goal_id = p.goal_id),
                   0
                 )
               ELSE
                 COALESCE(
                   (SELECT SUM(amount) FROM piggy_bank_deposits WHERE piggy_bank_id = p.id),
                   0
                 )
               END AS saved
        FROM piggy_banks p
        LEFT JOIN goals g ON g.id = p.goal_id
        WHERE p.client_id = ?
        ORDER BY p.created_at DESC
        """,
        (client_id,),
    ).fetchall()
