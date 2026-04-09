from __future__ import annotations

import os

from flask import Blueprint, abort, send_from_directory

# Собранный фронтенд: `cd client && npm install && npm run build` → client/dist
ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "client", "dist")
)

static_site_bp = Blueprint("static_site", __name__)


@static_site_bp.route("/", defaults={"filename": "index.html"})
@static_site_bp.route("/<path:filename>")
def static_files(filename: str):
    if filename.startswith("api") or ".." in filename:
        abort(404)
    safe = os.path.normpath(filename).replace("\\", "/").lstrip("/")
    if safe.startswith(".."):
        abort(404)
    root_abs = os.path.abspath(ROOT)
    full = os.path.abspath(os.path.join(ROOT, safe))
    if full != root_abs and not full.startswith(root_abs + os.sep):
        abort(404)
    if os.path.isdir(full):
        return send_from_directory(ROOT, "index.html")
    if os.path.isfile(full):
        return send_from_directory(ROOT, safe)
    abort(404)
