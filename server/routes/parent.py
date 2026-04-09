from __future__ import annotations

from flask import Blueprint, abort, jsonify

from achievements import (
    ACHIEVEMENT_LABELS,
    current_week_id,
    evaluate_achievements,
    iso_week_id,
    parse_tx_date,
)
from db import get_db
from repositories import digest_repo, goals_repo
from validation import valid_client_id

parent_bp = Blueprint("parent", __name__, url_prefix="/api/client")


@parent_bp.route("/<client_id>/parent-digest", methods=["GET"])
def parent_digest(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    week_id = current_week_id()
    conn = get_db()
    evaluate_achievements(conn, client_id)
    goal_rows = goals_repo.fetch_active_goals_ordered(conn, client_id)
    goals_out = []
    for goal in goal_rows:
        total = goals_repo.sum_contributions_for_goal(conn, goal["id"])
        wsum = 0
        for r in goals_repo.fetch_contribution_amounts_for_goal(conn, goal["id"]):
            dt = parse_tx_date(r["contributed_at"])
            if dt and iso_week_id(dt) == week_id:
                wsum += int(r["amount"])
        plan = int(goal["weekly_amount"])
        goals_out.append(
            {
                "title": goal["title"],
                "target": int(goal["target_amount"]),
                "saved": int(total),
                "weekly_plan": plan,
                "weekly_fact": wsum,
                "deadline": goal["deadline"],
                "on_track": wsum >= plan,
            }
        )
    goal_block = goals_out[0] if goals_out else None
    ach_rows = digest_repo.fetch_achievement_keys_for_week(conn, client_id, week_id)
    achievements_week = [
        {
            "key": r["achievement_key"],
            "title": ACHIEVEMENT_LABELS.get(r["achievement_key"], r["achievement_key"]),
        }
        for r in ach_rows
    ]
    pending = digest_repo.count_pending_savings_ideas(conn, client_id)
    talk = "Обсудите с ребёнком, как идёт накопление и что помогает не тратить лишнего."
    if goals_out:
        on_track_n = sum(1 for g in goals_out if g["on_track"])
        if on_track_n == len(goals_out):
            talk = (
                "Неделя по целям в графике — отличный повод похвалить и закрепить привычку откладывать."
            )
        elif on_track_n == 0:
            talk = (
                "На этой неделе взносы по целям ниже плана — мягко выясните, не мешает ли что-то, и можно ли разбить цели на меньшие шаги."
            )
        else:
            talk = (
                "Часть целей в графике на неделю, часть — нет: обсудите, что помогает одним и мешает другим."
            )
    conn.close()
    return jsonify(
        week_id=week_id,
        goals=goals_out,
        goal=goal_block,
        achievements_week=achievements_week,
        pending_ideas=int(pending),
        talk_topic=talk,
    )
