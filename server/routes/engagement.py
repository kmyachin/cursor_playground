from __future__ import annotations

import uuid

from flask import Blueprint, abort, jsonify, request

from achievements import current_week_id, evaluate_achievements
from db import get_db
from utils import utc_now_iso
from validation import valid_client_id

engagement_bp = Blueprint("engagement", __name__, url_prefix="/api/client")


@engagement_bp.route("/<client_id>/track", methods=["POST"])
def track_engagement(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    et = body.get("event")
    if et not in ("history_view", "goal_view"):
        abort(400)
    week_id = current_week_id()
    eid = str(uuid.uuid4())
    conn = get_db()
    conn.execute(
        """
        INSERT INTO engagement_log (id, client_id, event_type, week_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (eid, client_id, et, week_id, utc_now_iso()),
    )
    evaluate_achievements(conn, client_id)
    conn.commit()
    conn.close()
    return jsonify(ok=True)
