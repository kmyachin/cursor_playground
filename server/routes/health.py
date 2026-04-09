from __future__ import annotations

from flask import Blueprint, jsonify

health_bp = Blueprint("health", __name__, url_prefix="/api")


@health_bp.route("/health", methods=["GET"])
def health():
    return jsonify(ok=True, service="zernyshko-api")
