from __future__ import annotations

from datetime import date


def goal_plan_from_deadline(target: int, deadline_d: date) -> tuple[int, int]:
    today = date.today()
    days = (deadline_d - today).days
    num_weeks = max(1, (days + 6) // 7)
    weekly = (target + num_weeks - 1) // num_weeks
    weekly = max(50, (weekly + 24) // 25 * 25)
    return weekly, num_weeks
