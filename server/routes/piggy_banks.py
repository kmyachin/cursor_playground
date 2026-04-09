from __future__ import annotations

from datetime import date

from flask import Blueprint, abort, jsonify, request

from services.piggy_service import (
    attach_goal_to_piggy_transaction,
    contribute_standalone_piggy_transaction,
    insert_standalone_piggy_bank,
    piggy_banks_list_payload,
)
from validation import valid_client_id

piggy_banks_bp = Blueprint("piggy_banks", __name__, url_prefix="/api/client")


@piggy_banks_bp.route("/<client_id>/piggy-banks", methods=["GET"])
def list_piggy_banks(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    return jsonify(banks=piggy_banks_list_payload(client_id))


@piggy_banks_bp.route("/<client_id>/piggy-banks", methods=["POST"])
def create_piggy_bank(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get("title") or "").strip()
    emoji = (body.get("emoji") or "").strip() or "🐷"
    if len(emoji) > 16:
        return jsonify(ok=False, error="bad_emoji", message="Слишком длинный эмодзи"), 400
    if not title or len(title) > 200:
        return jsonify(ok=False, error="bad_title", message="Укажи название копилки"), 400
    standalone_target = body.get("standalone_target")
    st_val: int | None = None
    if standalone_target is not None and standalone_target != "":
        try:
            st_val = int(standalone_target)
        except (TypeError, ValueError):
            return jsonify(ok=False, error="bad_target", message="Некорректная сумма"), 400
        if st_val < 100:
            return jsonify(ok=False, error="bad_target", message="Минимум 100 ₽"), 400

    pid = insert_standalone_piggy_bank(client_id, title, emoji, st_val)
    return jsonify(ok=True, piggy_bank_id=pid)


@piggy_banks_bp.route(
    "/<client_id>/piggy-banks/<piggy_id>/contribute", methods=["POST"]
)
def contribute_piggy_bank(client_id: str, piggy_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    try:
        amount = int(body.get("amount"))
    except (TypeError, ValueError):
        return jsonify(ok=False, error="bad_amount", message="Укажи сумму"), 400
    if amount < 1:
        return jsonify(ok=False, error="bad_amount", message="Сумма от 1 ₽"), 400

    payload, status = contribute_standalone_piggy_transaction(client_id, piggy_id, amount)
    return jsonify(payload), status


@piggy_banks_bp.route("/<client_id>/piggy-banks/<piggy_id>/goal", methods=["POST"])
def attach_goal_to_piggy(client_id: str, piggy_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get("title") or "").strip()
    target = body.get("target_amount")
    deadline_s = body.get("deadline")
    if not title or len(title) > 200:
        return jsonify(ok=False, error="bad_title", message="Укажи название цели"), 400
    try:
        target = int(target)
    except (TypeError, ValueError):
        return jsonify(ok=False, error="bad_amount", message="Укажи сумму"), 400
    if target < 100:
        return jsonify(ok=False, error="bad_amount", message="Минимум 100 ₽"), 400
    try:
        deadline_d = date.fromisoformat(str(deadline_s)[:10])
    except (ValueError, TypeError):
        return jsonify(ok=False, error="bad_deadline", message="Укажи дату"), 400
    today = date.today()
    if deadline_d <= today:
        return jsonify(
            ok=False, error="bad_deadline", message="Дата должна быть в будущем"
        ), 400

    payload, status = attach_goal_to_piggy_transaction(
        client_id, piggy_id, title, target, deadline_d
    )
    return jsonify(payload), status
