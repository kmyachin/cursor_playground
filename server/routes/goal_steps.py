from __future__ import annotations

from flask import Blueprint, abort, jsonify, request

from services.goal_steps_service import (
    approve_goal_step_transaction,
    create_goal_step_insert,
    goal_steps_list_payload,
    mark_goal_step_done_update,
    reject_goal_step_update,
)
from validation import valid_client_id

goal_steps_bp = Blueprint("goal_steps", __name__, url_prefix="/api/client")


@goal_steps_bp.route("/<client_id>/goal-steps", methods=["GET"])
def list_goal_steps(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    status_filter = (request.args.get("status") or "").strip()
    steps = goal_steps_list_payload(client_id, status_filter)
    return jsonify(steps=steps)


@goal_steps_bp.route("/<client_id>/goals/<goal_id>/steps", methods=["POST"])
def create_goal_step(client_id: str, goal_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get("title") or "").strip()
    if not title or len(title) > 500:
        return jsonify(ok=False, error="bad_title", message="Укажи название шага"), 400
    raw_rew = body.get("reward_amount")
    reward = 0
    if raw_rew is not None and raw_rew != "":
        try:
            reward = int(raw_rew)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="bad_reward", message="Некорректная сумма"), 400
    if reward < 0 or reward > 500_000:
        return jsonify(ok=False, error="bad_reward", message="Сумма от 0 до 500 000 ₽"), 400

    payload, status = create_goal_step_insert(client_id, goal_id, title, reward)
    return jsonify(payload), status


@goal_steps_bp.route(
    "/<client_id>/goals/<goal_id>/steps/<step_id>/done", methods=["POST"]
)
def mark_goal_step_done(client_id: str, goal_id: str, step_id: str):
    if not valid_client_id(client_id):
        abort(400)
    payload, status = mark_goal_step_done_update(client_id, goal_id, step_id)
    return jsonify(payload), status


@goal_steps_bp.route(
    "/<client_id>/goals/<goal_id>/steps/<step_id>/approve", methods=["POST"]
)
def approve_goal_step(client_id: str, goal_id: str, step_id: str):
    if not valid_client_id(client_id):
        abort(400)
    payload, status = approve_goal_step_transaction(client_id, goal_id, step_id)
    return jsonify(payload), status


@goal_steps_bp.route(
    "/<client_id>/goals/<goal_id>/steps/<step_id>/reject", methods=["POST"]
)
def reject_goal_step(client_id: str, goal_id: str, step_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    note = (body.get("parent_note") or "").strip()[:500]
    payload, status = reject_goal_step_update(client_id, goal_id, step_id, note)
    return jsonify(payload), status
