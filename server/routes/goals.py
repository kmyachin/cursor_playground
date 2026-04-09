from __future__ import annotations

from datetime import date

from flask import Blueprint, abort, jsonify, request

from services.goals_service import (
    contribute_goal_transaction,
    create_goal_with_piggy,
    goals_list_payload,
)
from validation import valid_client_id

goals_bp = Blueprint("goals", __name__, url_prefix="/api/client")


@goals_bp.route("/<client_id>/goals", methods=["GET"])
def list_goals(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    return jsonify(goals=goals_list_payload(client_id))


@goals_bp.route("/<client_id>/goals", methods=["POST"])
def create_goal(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get("title") or "").strip()
    target = body.get("target_amount")
    deadline_s = body.get("deadline")
    if not title or len(title) > 200:
        abort(400, description="Название цели")
    try:
        target = int(target)
    except (TypeError, ValueError):
        abort(400, description="Сумма")
    if target < 100:
        abort(400, description="Минимум 100 ₽")
    try:
        deadline_d = date.fromisoformat(str(deadline_s)[:10])
    except (ValueError, TypeError):
        abort(400, description="Дата")
    today = date.today()
    if deadline_d <= today:
        abort(400, description="Дата в будущем")
    gid, weekly, num_weeks = create_goal_with_piggy(client_id, title, target, deadline_d)
    return jsonify(ok=True, goal_id=gid, weekly_amount=weekly, num_weeks=num_weeks)


@goals_bp.route("/<client_id>/goals/<goal_id>/contribute", methods=["POST"])
def contribute_goal(client_id: str, goal_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    try:
        amount = int(body.get("amount"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="bad_amount", message="Укажи сумму"), 400
    if amount < 1:
        return jsonify(ok=False, error="bad_amount", message="Сумма от 1 ₽"), 400

    payload, status = contribute_goal_transaction(client_id, goal_id, amount)
    return jsonify(payload), status
