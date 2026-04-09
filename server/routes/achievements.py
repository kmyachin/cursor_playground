from __future__ import annotations

import json

from flask import Blueprint, abort, jsonify

from achievements import ACHIEVEMENT_LABELS, evaluate_achievements
from db import get_db
from validation import valid_client_id

achievements_bp = Blueprint("achievements", __name__, url_prefix="/api/client")


@achievements_bp.route("/<client_id>/achievements", methods=["GET"])
def list_achievements(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    conn = get_db()
    evaluate_achievements(conn, client_id)
    rows = conn.execute(
        "SELECT * FROM achievement_unlocks WHERE client_id = ? ORDER BY unlocked_at DESC LIMIT 50",
        (client_id,),
    ).fetchall()
    conn.close()
    return jsonify(
        achievements=[
            {
                "key": r["achievement_key"],
                "title": ACHIEVEMENT_LABELS.get(
                    r["achievement_key"], r["achievement_key"]
                ),
                "week_id": r["week_id"],
                "detail": json.loads(r["detail_json"] or "{}"),
                "unlocked_at": r["unlocked_at"],
            }
            for r in rows
        ]
    )
