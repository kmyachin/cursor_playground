from __future__ import annotations

import json
import sqlite3

from flask import Blueprint, abort, jsonify, request

from achievements import evaluate_achievements
from db import get_db
from utils import utc_now_iso
from validation import valid_client_id

client_bp = Blueprint("client", __name__, url_prefix="/api/client")


@client_bp.route("/<client_id>", methods=["GET"])
def get_client(client_id: str):
    if not valid_client_id(client_id):
        abort(400, description="Некорректный client_id")

    conn = get_db()
    row = conn.execute(
        "SELECT app_state, session, extras FROM client_data WHERE client_id = ?",
        (client_id,),
    ).fetchone()

    kv_rows = conn.execute(
        "SELECT state_key, value_json FROM state_kv WHERE client_id = ?",
        (client_id,),
    ).fetchall()
    conn.close()

    extras_kv = {r["state_key"]: json.loads(r["value_json"]) for r in kv_rows}

    if not row:
        return jsonify(
            app_state=None,
            session=None,
            extras={},
            extras_kv=extras_kv,
        )

    extras_obj = {}
    try:
        extras_obj = json.loads(row["extras"] or "{}")
    except json.JSONDecodeError:
        extras_obj = {}

    sess = None
    if row["session"]:
        try:
            sess = json.loads(row["session"])
        except json.JSONDecodeError:
            sess = None

    app_state = None
    try:
        app_state = json.loads(row["app_state"] or "{}")
    except json.JSONDecodeError:
        app_state = {}

    return jsonify(
        app_state=app_state,
        session=sess,
        extras=extras_obj,
        extras_kv=extras_kv,
    )


@client_bp.route("/<client_id>", methods=["PUT"])
def put_client(client_id: str):
    if not valid_client_id(client_id):
        abort(400, description="Некорректный client_id")

    body = request.get_json(force=True, silent=True)
    if not isinstance(body, dict):
        body = {}

    conn = get_db()
    row = conn.execute(
        "SELECT app_state, session, extras FROM client_data WHERE client_id = ?",
        (client_id,),
    ).fetchone()

    now = utc_now_iso()

    if row:
        try:
            cur_app = json.loads(row["app_state"] or "{}")
        except json.JSONDecodeError:
            cur_app = {}
        try:
            cur_extras = json.loads(row["extras"] or "{}")
        except json.JSONDecodeError:
            cur_extras = {}
        cur_session = row["session"]
    else:
        cur_app = {}
        cur_extras = {}
        cur_session = None

    if "app_state" in body and body["app_state"] is not None:
        if not isinstance(body["app_state"], dict):
            abort(400, description="app_state должен быть объектом")
        cur_app = body["app_state"]

    if "session" in body:
        if body["session"] is None:
            cur_session = None
        elif isinstance(body["session"], dict):
            cur_session = json.dumps(body["session"], ensure_ascii=False)
        else:
            abort(400, description="session должен быть объектом или null")

    if "extras" in body and body["extras"] is not None:
        if not isinstance(body["extras"], dict):
            abort(400, description="extras должен быть объектом")
        cur_extras = body["extras"]

    session_sql = cur_session
    conn.execute(
        """
        INSERT INTO client_data (client_id, app_state, session, extras, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET
            app_state = excluded.app_state,
            session = excluded.session,
            extras = excluded.extras,
            updated_at = excluded.updated_at
        """,
        (
            client_id,
            json.dumps(cur_app, ensure_ascii=False),
            session_sql,
            json.dumps(cur_extras, ensure_ascii=False),
            now,
        ),
    )
    conn.commit()
    evaluate_achievements(conn, client_id)
    conn.close()

    return jsonify(ok=True, updated_at=now)


@client_bp.route("/<client_id>/kv/<path:key>", methods=["PUT"])
def put_kv(client_id: str, key: str):
    """Отдельные пары ключ — JSON (симуляторы, черновики и т.д.)."""
    if not valid_client_id(client_id):
        abort(400, description="Некорректный client_id")
    if not key or len(key) > 120 or ".." in key:
        abort(400, description="Некорректный ключ")

    body = request.get_json(force=True, silent=True)
    if body is None:
        abort(400, description="Ожидался JSON")

    now = utc_now_iso()
    conn = get_db()
    conn.execute(
        """
        INSERT INTO state_kv (client_id, state_key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(client_id, state_key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        """,
        (client_id, key, json.dumps(body, ensure_ascii=False), now),
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True, key=key, updated_at=now)


@client_bp.route("/<client_id>/kv/<path:key>", methods=["DELETE"])
def delete_kv(client_id: str, key: str):
    if not valid_client_id(client_id):
        abort(400, description="Некорректный client_id")
    conn = get_db()
    conn.execute(
        "DELETE FROM state_kv WHERE client_id = ? AND state_key = ?",
        (client_id, key),
    )
    conn.commit()
    conn.close()
    return jsonify(ok=True)
