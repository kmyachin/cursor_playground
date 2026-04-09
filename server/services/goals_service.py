from __future__ import annotations

import sqlite3
import uuid
from datetime import date

from achievements import evaluate_achievements, load_app_state
from app_state import normalize_app_state, upsert_app_state
from db import get_db
from goal_plan import goal_plan_from_deadline
from repositories import goals_repo, piggy_repo
from utils import utc_now_iso


def goals_list_payload(client_id: str) -> list[dict]:
    conn = get_db()
    try:
        rows = goals_repo.fetch_goals_for_client_ordered(conn, client_id)
        out: list[dict] = []
        for g in rows:
            total = goals_repo.sum_contributions_for_goal(conn, g["id"])
            contribs = goals_repo.fetch_contributions_ordered_desc(conn, g["id"])
            out.append(
                {
                    "id": g["id"],
                    "title": g["title"],
                    "target_amount": g["target_amount"],
                    "deadline": g["deadline"],
                    "weekly_amount": g["weekly_amount"],
                    "num_weeks": g["num_weeks"],
                    "created_at": g["created_at"],
                    "active": bool(g["active"]),
                    "saved_total": int(total),
                    "contributions": [
                        {"id": c["id"], "amount": c["amount"], "at": c["contributed_at"]}
                        for c in contribs
                    ],
                }
            )
        return out
    finally:
        conn.close()


def create_goal_with_piggy(
    client_id: str, title: str, target: int, deadline_d: date
) -> tuple[str, int, int]:
    """Создаёт цель и копилку. Возвращает goal_id, weekly_amount, num_weeks."""
    weekly, num_weeks = goal_plan_from_deadline(target, deadline_d)
    conn = get_db()
    try:
        gid = str(uuid.uuid4())
        now = utc_now_iso()
        goals_repo.insert_goal(
            conn,
            gid,
            client_id,
            title,
            target,
            deadline_d.isoformat(),
            weekly,
            num_weeks,
            now,
        )
        piggy_repo.insert_piggy_for_goal(
            conn, str(uuid.uuid4()), client_id, gid, title, "🎯", now
        )
        conn.commit()
        return gid, weekly, num_weeks
    finally:
        conn.close()


def contribute_goal_transaction(
    client_id: str, goal_id: str, amount: int
) -> tuple[dict, int]:
    conn = get_db()
    contribution_id: str | None = None
    effective = 0
    try:
        conn.execute("BEGIN IMMEDIATE")
        g = goals_repo.fetch_goal_by_id(conn, goal_id, client_id)
        if not g:
            conn.rollback()
            return (
                {"ok": False, "error": "not_found", "message": "Цель не найдена"},
                404,
            )

        if not piggy_repo.piggy_bank_id_for_goal(conn, goal_id, client_id):
            piggy_repo.insert_piggy_for_goal(
                conn,
                str(uuid.uuid4()),
                client_id,
                goal_id,
                g["title"],
                "🎯",
                g["created_at"],
            )

        total = goals_repo.sum_contributions_for_goal(conn, goal_id)
        remaining = int(g["target_amount"]) - int(total)
        if remaining <= 0:
            conn.rollback()
            return (
                {
                    "ok": False,
                    "error": "goal_complete",
                    "message": "Цель уже достигнута",
                },
                400,
            )

        raw_app = load_app_state(conn, client_id)
        app_state = normalize_app_state(raw_app)
        settings = app_state.get("settings") or {}
        if settings.get("cardBlocked"):
            conn.rollback()
            return (
                {
                    "ok": False,
                    "error": "card_blocked",
                    "message": "Карта заблокирована",
                },
                400,
            )

        balance = int(app_state["balance"])
        effective = min(amount, balance, remaining)
        if effective < 1:
            conn.rollback()
            if balance < 1:
                return (
                    {
                        "ok": False,
                        "error": "insufficient_funds",
                        "message": "Недостаточно средств на карте",
                    },
                    400,
                )
            return (
                {
                    "ok": False,
                    "error": "goal_complete",
                    "message": "Цель уже достигнута",
                },
                400,
            )

        app_state["balance"] = balance - effective
        tx = {
            "title": f"Перевод в копилку: {g['title']}",
            "amount": -effective,
            "category": "Копилка",
            "kind": "savings_transfer",
            "date": utc_now_iso(),
        }
        app_state.setdefault("extraTransactions", []).append(tx)

        contribution_id = str(uuid.uuid4())
        now = utc_now_iso()
        goals_repo.insert_goal_contribution(
            conn, contribution_id, goal_id, effective, now
        )
        upsert_app_state(conn, client_id, app_state)
        evaluate_achievements(conn, client_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return (
        {
            "ok": True,
            "contribution_id": contribution_id,
            "amount": effective,
        },
        200,
    )


def ensure_piggy_for_goal(
    conn: sqlite3.Connection, client_id: str, goal_id: str, goal_row: sqlite3.Row
) -> None:
    """Используется из goal_steps_service при approve."""
    if not piggy_repo.piggy_bank_id_for_goal(conn, goal_id, client_id):
        piggy_repo.insert_piggy_for_goal(
            conn,
            str(uuid.uuid4()),
            client_id,
            goal_id,
            goal_row["title"],
            "🎯",
            goal_row["created_at"],
        )
