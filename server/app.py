"""
Зёрнышко — API и раздача статики.

Запуск из корня репозитория:
  cd server && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
  python app.py

Откройте http://127.0.0.1:5000/app.html

SQLite: server/zernyshko.db — клиентские снимки состояния (app_state, session, extras).
"""

from __future__ import annotations

import os

from flask import Flask
from flask_cors import CORS

from migrations import init_db
from routes.achievements import achievements_bp
from routes.client import client_bp
from routes.engagement import engagement_bp
from routes.goal_steps import goal_steps_bp
from routes.goals import goals_bp
from routes.health import health_bp
from routes.parent import parent_bp
from routes.piggy_banks import piggy_banks_bp
from routes.savings_ideas import savings_ideas_bp
from routes.static_site import static_site_bp

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/api/*": {"origins": "*"}})
init_db()

app.register_blueprint(health_bp)
app.register_blueprint(client_bp)
app.register_blueprint(achievements_bp)
app.register_blueprint(goals_bp)
app.register_blueprint(goal_steps_bp)
app.register_blueprint(piggy_banks_bp)
app.register_blueprint(savings_ideas_bp)
app.register_blueprint(engagement_bp)
app.register_blueprint(parent_bp)
app.register_blueprint(static_site_bp)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    debug = os.environ.get("FLASK_DEBUG", "true").lower() in ("1", "true", "yes")
    host = os.environ.get("FLASK_HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=debug)
