"""Body-first daily suggestions. All rules are provisional product experiments."""
from datetime import date
from statistics import median

from .domain import ValidationError, choice, number, text_field


def daily_input(data):
    if not isinstance(data, dict):
        raise ValidationError("Enter a JSON object.")
    try:
        day = date.fromisoformat(data.get("date", "")).isoformat()
    except (TypeError, ValueError):
        raise ValidationError("Choose a valid check-in date.") from None
    soreness = choice(data, "soreness", ("none", "mild", "significant", "pain", "unknown"))
    return {
        "date": day,
        "sleep_hours": number(data, "sleep_hours", 0, 24, optional=True),
        "sleep_quality": choice(data, "sleep_quality", ("good", "okay", "poor", "unknown")),
        "energy": choice(data, "energy", ("low", "normal", "high", "unknown")),
        "fatigue": choice(data, "fatigue", ("low", "moderate", "high", "unknown")),
        "soreness": soreness,
        "soreness_area": "" if soreness == "none" else text_field(data, "soreness_area", 80),
        "available_minutes": number(data, "available_minutes", 0, 300),
    }


def suggest_daily(checkin, profile, runs):
    """Select a light session without requiring a preselected workout.

    Recent completed durations anchor duration only; this is not a training plan.
    Sleep duration and quality count as one dimension, not two independent votes.
    """
    day = date.fromisoformat(checkin["date"])
    prior = [r for r in runs if 0 <= (day - date.fromisoformat(r["date"])).days <= 14]
    recent = [r for r in prior if (day - date.fromisoformat(r["date"])).days <= 2]
    demanding = any(r["effort"] >= 7 for r in recent)
    concerns = []
    reasons = []
    uncertainty = ["Early prototype: these rules and durations are not validated training prescriptions."]
    sleep = checkin["sleep_hours"]
    if (sleep is not None and sleep < 6) or checkin["sleep_quality"] == "poor":
        concerns.append("Your sleep check-in suggests you may be less rested today.")
    if checkin["energy"] == "low":
        concerns.append("You reported low energy.")
    if checkin["fatigue"] == "high":
        concerns.append("You reported high fatigue.")
    if sleep is None or checkin["sleep_quality"] == "unknown":
        uncertainty.append("Your sleep information is incomplete.")
    for field in ("energy", "fatigue", "soreness"):
        if checkin[field] == "unknown":
            uncertainty.append(f"Your {field} is unknown.")
    if prior:
        base = min(45, round(median(r["minutes"] for r in prior)))
        reasons.append("Recent logged run durations provide a starting point for today's duration.")
    else:
        base = 20
        uncertainty.append("No runs are logged in the previous 14 days. The 20-minute starting point is a provisional default, not a personal baseline.")
    if demanding:
        reasons.append("A demanding run is logged in the previous two days.")
    missing = sleep is None or any(checkin[k] == "unknown" for k in ("sleep_quality", "energy", "fatigue", "soreness"))
    kind = "easy"
    action = "suggest"
    minutes = min(base, checkin["available_minutes"])
    local = checkin["soreness"]
    if local == "pain":
        kind, minutes, action = "rest", 0, "rest"
        reasons.append("You reported pain beyond normal soreness. Pause running and assess it before resuming.")
    elif checkin["available_minutes"] < 5:
        kind, minutes, action = "rest", 0, "rest"
        reasons.append("There isn't time available for a run today.")
    elif len(concerns) >= 2 and (local == "significant" or demanding):
        kind, minutes, action = "rest", 0, "rest"
        reasons.append("Several overall recovery concerns overlap with soreness or recent running demands.")
    elif len(concerns) >= 2 or local == "significant" or demanding or missing:
        minutes = min(minutes, max(5, round(base * 0.7)))
        action = "adjust"
        reasons.append("A shorter easy run keeps today's demands light while recovery or context is uncertain.")
    else:
        reasons.append("An easy, conversational run is the starting suggestion from your available check-in.")
    reasons.extend(concerns)
    if local in ("mild", "significant"):
        area = f" around {checkin['soreness_area']}" if checkin["soreness_area"] else ""
        reasons.append(f"You reported {local} soreness{area}.")
    if kind != "rest" and minutes == checkin["available_minutes"]:
        reasons.append("The duration fits the time you have available.")
    uncertainty.append("Goal-specific workouts, performance trends, HRV baselines, and a full training plan are not assessed yet. This version suggests easy running or recovery only.")
    uncertainty.append(f"Your {'race preparation' if profile['goal'] == 'race' else 'general fitness'} goal is saved, but does not yet produce a goal-specific session.")
    return {
        "action": action, "session_type": kind, "minutes": minutes,
        "intensity": "No run suggested today." if kind == "rest" else "Comfortable, conversational effort. You should be able to speak in full sentences.",
        "reasons": reasons, "uncertainty": uncertainty,
        "states": {"systemic": "concerns" if concerns else ("incomplete" if missing else "no reported concerns"),
                   "local": local, "load": "recent demands" if demanding else "limited history", "performance": "not assessed"},
        "rule_version": "daily-prototype-1",
    }
