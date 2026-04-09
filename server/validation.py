from __future__ import annotations

import re
import uuid

CLIENT_ID_RE = re.compile(r"^[a-f0-9\-]{36}$", re.I)


def valid_client_id(client_id: str) -> bool:
    if not client_id or len(client_id) > 64:
        return False
    try:
        uuid.UUID(client_id)
        return True
    except ValueError:
        return CLIENT_ID_RE.match(client_id) is not None
