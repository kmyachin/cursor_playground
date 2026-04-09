from __future__ import annotations

import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(__file__), "zernyshko.db")


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
