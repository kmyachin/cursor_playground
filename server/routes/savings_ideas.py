from __future__ import annotations

import uuid

from flask import Blueprint, abort, jsonify, request

from achievements import current_week_id, evaluate_achievements, try_unlock
from db import get_db
from utils import utc_now_iso
from validation import valid_client_id

savings_ideas_bp = Blueprint("savings_ideas", __name__, url_prefix="/api/client")


@savings_ideas_bp.route("/<client_id>/savings-ideas", methods=["GET"])
def list_ideas(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    status = request.args.get("status", "pending")
    conn = get_db()
    q = "SELECT * FROM savings_ideas WHERE client_id = ?"
    args: list = [client_id]
    if status in ("pending", "approved", "rejected"):
        q += " AND status = ?"
        args.append(status)
    q += " ORDER BY created_at DESC"
    rows = conn.execute(q, args).fetchall()
    conn.close()
    return jsonify(
        ideas=[
            {
                "id": r["id"],
                "text": r["idea_text"],
                "status": r["status"],
                "created_at": r["created_at"],
                "resolved_at": r["resolved_at"],
            }
            for r in rows
        ]
    )


@savings_ideas_bp.route("/<client_id>/savings-ideas", methods=["POST"])
def create_idea(client_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    text = (body.get("text") or "").strip()
    if not text or len(text) > 500:
        abort(400)
    iid = str(uuid.uuid4())
    now = utc_now_iso()
    conn = get_db()
    conn.execute(
        """
        INSERT INTO savings_ideas (id, client_id, idea_text, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
        """,
        (iid, client_id, text, now),
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True, id=iid)


@savings_ideas_bp.route(
    "/<client_id>/savings-ideas/<idea_id>/resolve", methods=["POST"]
)
def resolve_idea(client_id: str, idea_id: str):
    if not valid_client_id(client_id):
        abort(400)
    body = request.get_json(force=True, silent=True) or {}
    action = body.get("action")
    if action not in ("approve", "reject"):
        abort(400)
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM savings_ideas WHERE id = ? AND client_id = ?",
        (idea_id, client_id),
    ).fetchone()
    if not row:
        conn.close()
        abort(404)
    if row["status"] != "pending":
        conn.close()
        abort(400, description="Уже обработано")
    st = "approved" if action == "approve" else "rejected"
    now = utc_now_iso()
    conn.execute(
        "UPDATE savings_ideas SET status = ?, resolved_at = ? WHERE id = ?",
        (st, now, idea_id),
    )
    if action == "approve":
        week_id = current_week_id()
        try_unlock(
            conn,
            client_id,
            "idea_hero",
            week_id,
            {"idea_id": idea_id, "preview": row["idea_text"][:80]},
        )
    evaluate_achievements(conn, client_id)
    conn.commit()
    conn.close()
    return jsonify(ok=True, status=st)
