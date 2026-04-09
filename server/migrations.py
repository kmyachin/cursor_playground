from __future__ import annotations

import sqlite3
import uuid

from db import get_db


def migrate_piggy_banks(conn: sqlite3.Connection) -> None:
    """Копилка на каждую цель; для уже существующих целей без записи — создать."""
    rows = conn.execute(
        """
        SELECT g.id, g.client_id, g.title, g.created_at FROM goals g
        WHERE NOT EXISTS (SELECT 1 FROM piggy_banks p WHERE p.goal_id = g.id)
        """
    ).fetchall()
    for r in rows:
        conn.execute(
            """
            INSERT INTO piggy_banks (id, client_id, goal_id, title, emoji, created_at, standalone_target)
            VALUES (?, ?, ?, ?, ?, ?, NULL)
            """,
            (str(uuid.uuid4()), r["client_id"], r["id"], r["title"], "🎯", r["created_at"]),
        )
    conn.commit()


def migrate_piggy_banks_schema(conn: sqlite3.Connection) -> None:
    """Nullable goal_id, standalone_target; таблица взносов без цели."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS piggy_bank_deposits (
            id TEXT PRIMARY KEY,
            piggy_bank_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            deposited_at TEXT NOT NULL
        )
        """
    )
    cols = conn.execute("PRAGMA table_info(piggy_banks)").fetchall()
    if not cols:
        return
    names = {row["name"] for row in cols}
    if "standalone_target" in names:
        return
    conn.execute("ALTER TABLE piggy_banks RENAME TO piggy_banks_old")
    conn.execute(
        """
        CREATE TABLE piggy_banks (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            goal_id TEXT UNIQUE,
            title TEXT NOT NULL,
            emoji TEXT NOT NULL DEFAULT '🐷',
            created_at TEXT NOT NULL,
            standalone_target INTEGER
        )
        """
    )
    conn.execute(
        """
        INSERT INTO piggy_banks (id, client_id, goal_id, title, emoji, created_at, standalone_target)
        SELECT id, client_id, goal_id, title, emoji, created_at, NULL FROM piggy_banks_old
        """
    )
    conn.execute("DROP TABLE piggy_banks_old")
    conn.commit()


def migrate_goal_steps_table(conn: sqlite3.Connection) -> None:
    """Старые БД без goal_steps."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS goal_steps (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            goal_id TEXT NOT NULL,
            title TEXT NOT NULL,
            reward_amount INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            done_at TEXT,
            resolved_at TEXT,
            parent_note TEXT
        )
        """
    )
    conn.commit()


def migrate_goal_steps_v2(conn: sqlite3.Connection) -> None:
    """Тип шага и текст мини-опроса."""
    cols = {r["name"] for r in conn.execute("PRAGMA table_info(goal_steps)").fetchall()}
    if not cols:
        return
    if "step_kind" not in cols:
        conn.execute(
            "ALTER TABLE goal_steps ADD COLUMN step_kind TEXT DEFAULT 'custom'"
        )
        conn.execute(
            "UPDATE goal_steps SET step_kind = 'custom' WHERE step_kind IS NULL"
        )
    if "reflection_text" not in cols:
        conn.execute("ALTER TABLE goal_steps ADD COLUMN reflection_text TEXT")
    conn.execute(
        "UPDATE goal_steps SET step_kind = 'custom' WHERE step_kind = 'price_compare'"
    )
    conn.commit()


def init_db() -> None:
    conn = get_db()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS client_data (
            client_id TEXT PRIMARY KEY,
            app_state TEXT NOT NULL DEFAULT '{}',
            session TEXT,
            extras TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS state_kv (
            client_id TEXT NOT NULL,
            state_key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (client_id, state_key)
        );

        CREATE TABLE IF NOT EXISTS goals (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            title TEXT NOT NULL,
            target_amount INTEGER NOT NULL,
            deadline TEXT NOT NULL,
            weekly_amount INTEGER NOT NULL,
            num_weeks INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS goal_contributions (
            id TEXT PRIMARY KEY,
            goal_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            contributed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS savings_ideas (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            idea_text TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL,
            resolved_at TEXT
        );

        CREATE TABLE IF NOT EXISTS achievement_unlocks (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            achievement_key TEXT NOT NULL,
            week_id TEXT NOT NULL,
            detail_json TEXT,
            unlocked_at TEXT NOT NULL,
            UNIQUE(client_id, achievement_key, week_id)
        );

        CREATE TABLE IF NOT EXISTS engagement_log (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            week_id TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS piggy_banks (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            goal_id TEXT UNIQUE,
            title TEXT NOT NULL,
            emoji TEXT NOT NULL DEFAULT '🐷',
            created_at TEXT NOT NULL,
            standalone_target INTEGER
        );

        CREATE TABLE IF NOT EXISTS piggy_bank_deposits (
            id TEXT PRIMARY KEY,
            piggy_bank_id TEXT NOT NULL,
            amount INTEGER NOT NULL,
            deposited_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goal_steps (
            id TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            goal_id TEXT NOT NULL,
            title TEXT NOT NULL,
            reward_amount INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            done_at TEXT,
            resolved_at TEXT,
            parent_note TEXT,
            step_kind TEXT NOT NULL DEFAULT 'custom',
            reflection_text TEXT
        );
        """
    )
    conn.commit()
    migrate_piggy_banks_schema(conn)
    migrate_piggy_banks(conn)
    migrate_goal_steps_table(conn)
    migrate_goal_steps_v2(conn)
    conn.close()
