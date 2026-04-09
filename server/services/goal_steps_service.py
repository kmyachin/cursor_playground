from __future__ import annotations

import uuid

from achievements import evaluate_achievements
from db import get_db
from repositories import goal_steps_repo, goals_repo
from services.goals_service import ensure_piggy_for_goal
from utils import utc_now_iso


def goal_steps_list_payload(client_id: str, status_filter: str) -> list[dict]:
    conn = get_db()
    try:
        rows = goal_steps_repo.fetch_goal_steps_for_client(conn, client_id, status_filter)
        return [
            {
                "id": r["id"],
                "goal_id": r["goal_id"],
                "goal_title": r["goal_title"],
                "title": r["title"],
                "reward_amount": int(r["reward_amount"]),
                "status": r["status"],
                "created_at": r["created_at"],
                "done_at": r["done_at"],
                "resolved_at": r["resolved_at"],
                "parent_note": r["parent_note"],
                "step_kind": (r["step_kind"] or "custom"),
            }
            for r in rows
        ]
    finally:
        conn.close()


def create_goal_step_insert(
    client_id: str, goal_id: str, title: str, reward: int
) -> tuple[dict, int]:
    conn = get_db()
    try:
        g = goals_repo.fetch_goal_by_id(conn, goal_id, client_id)
        if not g:
            return (
                {"ok": False, "error": "not_found", "message": "Цель не найдена"},
                404,
            )
        if not g["active"]:
            return (
                {"ok": False, "error": "inactive", "message": "Цель неактивна"},
                400,
            )

        sid = str(uuid.uuid4())
        now = utc_now_iso()
        goal_steps_repo.insert_goal_step_open(
            conn, sid, client_id, goal_id, title, reward, now
        )
        conn.commit()
        return ({"ok": True, "step_id": sid}, 200)
    finally:
        conn.close()


def mark_goal_step_done_update(
    client_id: str, goal_id: str, step_id: str
) -> tuple[dict, int]:
    conn = get_db()
    try:
        row = goal_steps_repo.fetch_goal_step(conn, step_id, goal_id, client_id)
        if not row:
            return (
                {"ok": False, "error": "not_found", "message": "Шаг не найден"},
                404,
            )
        if row["status"] != "open":
            return (
                {"ok": False, "error": "bad_state", "message": "Шаг уже отмечен"},
                400,
            )
        now = utc_now_iso()
        goal_steps_repo.update_step_done_pending(conn, now, step_id)
        conn.commit()
        return ({"ok": True}, 200)
    finally:
        conn.close()


def approve_goal_step_transaction(
    client_id: str, goal_id: str, step_id: str
) -> tuple[dict, int]:
    conn = get_db()
    contribution_id: str | None = None
    effective = 0
    want = 0
    try:
        conn.execute("BEGIN IMMEDIATE")
        step = goal_steps_repo.fetch_goal_step(conn, step_id, goal_id, client_id)
        if not step:
            conn.rollback()
            return (
                {"ok": False, "error": "not_found", "message": "Шаг не найден"},
                404,
            )
        if step["status"] != "done_pending":
            conn.rollback()
            return (
                {
                    "ok": False,
                    "error": "bad_state",
                    "message": "Шаг не ждёт подтверждения",
                },
                400,
            )

        g = goals_repo.fetch_goal_by_id(conn, goal_id, client_id)
        if not g:
            conn.rollback()
            return (
                {"ok": False, "error": "not_found", "message": "Цель не найдена"},
                404,
            )

        ensure_piggy_for_goal(conn, client_id, goal_id, g)

        total = goals_repo.sum_contributions_for_goal(conn, goal_id)
        remaining = int(g["target_amount"]) - int(total)
        want = int(step["reward_amount"])
        effective = min(want, max(0, remaining)) if want > 0 else 0

        now = utc_now_iso()
        if effective > 0:
            contribution_id = str(uuid.uuid4())
            goals_repo.insert_goal_contribution(
                conn, contribution_id, goal_id, effective, now
            )

        goal_steps_repo.update_step_paid(conn, now, step_id)
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
            "credited_amount": effective,
            "reward_requested": want,
        },
        200,
    )


def reject_goal_step_update(
    client_id: str, goal_id: str, step_id: str, note: str | None
) -> tuple[dict, int]:
    conn = get_db()
    try:
        row = goal_steps_repo.fetch_goal_step(conn, step_id, goal_id, client_id)
        if not row:
            return (
                {"ok": False, "error": "not_found", "message": "Шаг не найден"},
                404,
            )
        if row["status"] != "done_pending":
            return (
                {
                    "ok": False,
                    "error": "bad_state",
                    "message": "Шаг не ждёт подтверждения",
                },
                400,
            )

        now = utc_now_iso()
        goal_steps_repo.update_step_rejected(conn, now, note or None, step_id)
        conn.commit()
        return ({"ok": True}, 200)
    finally:
        conn.close()
