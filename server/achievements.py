from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from repositories import engagement_repo, goals_repo
from utils import utc_now_iso


def iso_week_id(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    y, w, _ = dt.isocalendar()
    return f"{y}-W{w:02d}"


def current_week_id() -> str:
    return iso_week_id(datetime.now(timezone.utc))


def parse_tx_date(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _is_savings_like_tx(t: dict) -> bool:
    """Переводы в копилку/цель не считаем «тратами» для недельного потолка."""
    if t.get("kind") == "savings_transfer":
        return True
    cat = (t.get("category") or "").strip().lower()
    return cat in ("копилка", "накопления", "цель")


def sum_negative_spend_in_week(app_state: dict, week_id: str) -> tuple[int, int]:
    txs = app_state.get("extraTransactions") or []
    total = 0
    n = 0
    for t in txs:
        if _is_savings_like_tx(t):
            continue
        amt = t.get("amount")
        if amt is None or amt >= 0:
            continue
        dt = parse_tx_date(t.get("date", ""))
        if dt is None:
            continue
        if iso_week_id(dt) != week_id:
            continue
        total += abs(int(amt))
        n += 1
    return total, n


def load_app_state(conn: sqlite3.Connection, client_id: str) -> dict:
    row = conn.execute(
        "SELECT app_state FROM client_data WHERE client_id = ?",
        (client_id,),
    ).fetchone()
    if not row or not row["app_state"]:
        return {}
    try:
        return json.loads(row["app_state"])
    except json.JSONDecodeError:
        return {}


def try_unlock(
    conn: sqlite3.Connection,
    client_id: str,
    key: str,
    week_id: str,
    detail: dict,
) -> bool:
    aid = str(uuid.uuid4())
    try:
        conn.execute(
            """
            INSERT INTO achievement_unlocks
            (id, client_id, achievement_key, week_id, detail_json, unlocked_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                aid,
                client_id,
                key,
                week_id,
                json.dumps(detail, ensure_ascii=False),
                utc_now_iso(),
            ),
        )
        return True
    except sqlite3.IntegrityError:
        return False


ACHIEVEMENT_LABELS = {
    "weekly_plan": "Неделя по плану",
    "spend_control": "Уложился в недельный потолок",
    "budget_watch": "Следил за тратами",
    "idea_hero": "Идея сэкономить",
}


def evaluate_achievements(conn: sqlite3.Connection, client_id: str) -> None:
    week_id = current_week_id()
    app_state = load_app_state(conn, client_id)
    settings = app_state.get("settings") or {}
    daily_limit = int(settings.get("dailyLimit") or 0)
    weekly_cap = max(daily_limit * 7, 1)

    goal_rows = goals_repo.fetch_active_goals_ordered(conn, client_id)

    for goal in goal_rows:
        rows = goals_repo.fetch_contribution_amounts_for_goal(conn, goal["id"])
        contrib_sum = 0
        for r in rows:
            dt = parse_tx_date(r["contributed_at"])
            if dt and iso_week_id(dt) == week_id:
                contrib_sum += int(r["amount"])
        if contrib_sum >= int(goal["weekly_amount"]):
            try_unlock(
                conn,
                client_id,
                "weekly_plan",
                week_id,
                {
                    "fact": contrib_sum,
                    "plan": int(goal["weekly_amount"]),
                    "goal_title": goal["title"],
                },
            )
            break

    spend, n_tx = sum_negative_spend_in_week(app_state, week_id)
    if n_tx > 0 and spend <= weekly_cap:
        try_unlock(
            conn,
            client_id,
            "spend_control",
            week_id,
            {"spent": spend, "cap": weekly_cap},
        )

    n_hist = engagement_repo.count_history_views_in_week(conn, client_id, week_id)
    if n_hist >= 3:
        try_unlock(
            conn,
            client_id,
            "budget_watch",
            week_id,
            {"visits": n_hist},
        )

    conn.commit()
