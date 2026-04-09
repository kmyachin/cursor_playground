from __future__ import annotations

import uuid
from datetime import date

from achievements import evaluate_achievements, load_app_state
from app_state import normalize_app_state, upsert_app_state
from db import get_db
from goal_plan import goal_plan_from_deadline
from repositories import goals_repo, piggy_repo
from utils import utc_now_iso


def piggy_banks_list_payload(client_id: str) -> list[dict]:
    conn = get_db()
    try:
        rows = piggy_repo.fetch_piggy_banks_with_saved(conn, client_id)
        banks: list[dict] = []
        for r in rows:
            has_goal = r["goal_id"] is not None
            if has_goal:
                banks.append(
                    {
                        "id": r["pid"],
                        "goal_id": r["goal_id"],
                        "title": r["title"],
                        "emoji": r["emoji"],
                        "target_amount": int(r["target_amount"]),
                        "standalone_target": None,
                        "deadline": r["deadline"],
                        "active": bool(r["active"]),
                        "saved_total": int(r["saved"]),
                    }
                )
            else:
                st = r["standalone_target"]
                banks.append(
                    {
                        "id": r["pid"],
                        "goal_id": None,
                        "title": r["title"],
                        "emoji": r["emoji"],
                        "target_amount": None,
                        "standalone_target": int(st) if st is not None else None,
                        "deadline": None,
                        "active": True,
                        "saved_total": int(r["saved"]),
                    }
                )
        return banks
    finally:
        conn.close()


def insert_standalone_piggy_bank(
    client_id: str, title: str, emoji: str, standalone_target: int | None
) -> str:
    pid = str(uuid.uuid4())
    now = utc_now_iso()
    conn = get_db()
    try:
        piggy_repo.insert_standalone_piggy(
            conn, pid, client_id, title, emoji, now, standalone_target
        )
        conn.commit()
        return pid
    finally:
        conn.close()


def contribute_standalone_piggy_transaction(
    client_id: str, piggy_id: str, amount: int
) -> tuple[dict, int]:
    conn = get_db()
    contribution_id: str | None = None
    effective = 0
    try:
        conn.execute("BEGIN IMMEDIATE")
        p = piggy_repo.fetch_standalone_piggy_bank(conn, piggy_id, client_id)
        if not p:
            conn.rollback()
            return (
                {
                    "ok": False,
                    "error": "not_found",
                    "message": "Копилка не найдена или у неё уже есть цель",
                },
                404,
            )

        total = piggy_repo.sum_deposits_for_piggy(conn, piggy_id)
        st = p["standalone_target"]
        remaining: int | None = None
        if st is not None:
            remaining = int(st) - int(total)
            if remaining <= 0:
                conn.rollback()
                return (
                    {
                        "ok": False,
                        "error": "piggy_full",
                        "message": "Уже достигнута сумма копилки",
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
        if remaining is None:
            effective = min(amount, balance)
        else:
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
                    "error": "piggy_full",
                    "message": "Уже достигнута сумма копилки",
                },
                400,
            )

        app_state["balance"] = balance - effective
        tx = {
            "title": f"Перевод в копилку: {p['title']}",
            "amount": -effective,
            "category": "Копилка",
            "kind": "savings_transfer",
            "date": utc_now_iso(),
        }
        app_state.setdefault("extraTransactions", []).append(tx)

        contribution_id = str(uuid.uuid4())
        now = utc_now_iso()
        piggy_repo.insert_piggy_deposit(conn, contribution_id, piggy_id, effective, now)
        upsert_app_state(conn, client_id, app_state)
        evaluate_achievements(conn, client_id)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    return (
        {"ok": True, "contribution_id": contribution_id, "amount": effective},
        200,
    )


def attach_goal_to_piggy_transaction(
    client_id: str,
    piggy_id: str,
    title: str,
    target: int,
    deadline_d: date,
) -> tuple[dict, int]:
    weekly, num_weeks = goal_plan_from_deadline(target, deadline_d)
    conn = get_db()
    gid = str(uuid.uuid4())
    now = utc_now_iso()
    try:
        conn.execute("BEGIN IMMEDIATE")
        p = piggy_repo.fetch_standalone_piggy_bank(conn, piggy_id, client_id)
        if not p:
            conn.rollback()
            return (
                {
                    "ok": False,
                    "error": "not_found",
                    "message": "Копилка не найдена или у неё уже есть цель",
                },
                404,
            )

        dep_sum = piggy_repo.sum_deposits_for_piggy(conn, piggy_id)

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
        if dep_sum > 0:
            goals_repo.insert_goal_contribution(
                conn, str(uuid.uuid4()), gid, dep_sum, now
            )
            piggy_repo.delete_deposits_for_piggy(conn, piggy_id)

        piggy_repo.update_piggy_attach_goal(
            conn, gid, title, "🎯", piggy_id, client_id
        )
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
            "goal_id": gid,
            "weekly_amount": weekly,
            "num_weeks": num_weeks,
        },
        200,
    )
