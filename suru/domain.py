"""Validated inputs and transparent, provisional recommendation rules.

These rules are product experiments, not validated physiological thresholds.
We deliberately do not use the legacy single-metric scoring functions.
"""
import math
from datetime import date


class ValidationError(ValueError):
    pass


def choice(data, key, allowed):
    value = data.get(key)
    if value not in allowed:
        raise ValidationError(f"{key}: choose one of {', '.join(allowed)}.")
    return value


def number(data, key, low, high, optional=False):
    raw = data.get(key)
    if optional and (raw is None or raw == ""):
        return None
    if isinstance(raw, bool):
        raise ValidationError(f"{key}: enter a number.")
    try:
        value = float(raw)
    except (ValueError, TypeError):
        raise ValidationError(f"{key}: enter a number.") from None
    if not math.isfinite(value) or not low <= value <= high:
        raise ValidationError(f"{key}: enter a number between {low} and {high}.")
    return value


def text_field(data, key, limit=500):
    value = data.get(key, "")
    if not isinstance(value, str) or len(value) > limit:
        raise ValidationError(f"{key}: use at most {limit} characters.")
    return value.strip()


def session_input(data):
    if not isinstance(data, dict):
        raise ValidationError("Enter a JSON object.")
    try:
        session_date = date.fromisoformat(data.get("date", "")).isoformat()
    except (ValueError, TypeError):
        raise ValidationError("date: enter a valid date.") from None
    return {
        "date": session_date,
        "goal": choice(data, "goal", ("fitness", "race")),
        "session_type": choice(data, "session_type", ("easy", "long", "tempo", "intervals")),
        "planned_minutes": number(data, "planned_minutes", 5, 300),
        "available_minutes": number(data, "available_minutes", 5, 300),
        "sleep_hours": number(data, "sleep_hours", 0, 24, optional=True),
        "energy": choice(data, "energy", ("low", "normal", "high")),
        "fatigue": choice(data, "fatigue", ("low", "moderate", "high")),
        "soreness": choice(data, "soreness", ("none", "mild", "significant", "pain")),
        "recent_load": choice(data, "recent_load", ("usual", "higher", "unknown")),
        "hrv": number(data, "hrv", 1, 500, optional=True),
        "notes": text_field(data, "notes"),
    }


def recommend(checkin, recent_runs):
    reasons = []
    uncertainty = ["Prototype rules: recommendations have not been validated for training outcomes."]
    minutes = min(checkin["planned_minutes"], checkin["available_minutes"])
    kind = checkin["session_type"]
    sleep = checkin["sleep_hours"]
    systemic = []
    if sleep is None:
        uncertainty.append("Sleep was not provided; overall recovery is less clear.")
    elif sleep < 6:
        systemic.append("You reported a short night of sleep.")
    if checkin["energy"] == "low":
        systemic.append("Your energy is low.")
    if checkin["fatigue"] == "high":
        systemic.append("You reported high fatigue.")

    prior = [r for r in recent_runs if 0 < (date.fromisoformat(checkin["date"]) - date.fromisoformat(r["date"])).days <= 2]
    demanding = any(r["effort"] >= 7 for r in prior)
    higher_load = checkin["recent_load"] == "higher"
    if demanding:
        reasons.append("You logged a demanding run in the previous two days.")
    if higher_load:
        reasons.append("You reported more training than usual.")
    if checkin["recent_load"] == "unknown":
        uncertainty.append("Your recent training load is unknown.")
    if not prior:
        uncertainty.append("No completed runs are logged for the previous two days; this does not establish recovery.")
    uncertainty.append("Performance trends and personal physiological baselines are not assessed yet.")
    if checkin["hrv"] is not None:
        uncertainty.append("HRV is recorded but does not change this suggestion: one reading cannot establish a personal trend.")
    else:
        uncertainty.append("No HRV data supplied; a wearable is optional.")

    action = "follow"
    if checkin["soreness"] == "pain":
        kind, minutes, action = "rest", 0, "rest"
        reasons.append("You reported pain. Pause running and assess it before resuming; seek qualified advice if it persists or is concerning.")
    elif len(systemic) >= 2 and (checkin["soreness"] == "significant" or higher_load or demanding):
        kind, minutes, action = "rest", 0, "rest"
        reasons.extend(systemic)
        reasons.append("Several recovery concerns overlap with soreness or recent training demands.")
    elif systemic or checkin["soreness"] == "significant" or ((higher_load or demanding) and kind in ("tempo", "intervals", "long")):
        kind, action = "easy", "adjust"
        minutes = min(minutes, round(checkin["planned_minutes"] * 0.7))
        reasons.extend(systemic)
        if checkin["soreness"] == "significant":
            reasons.append("Significant leg soreness supports reducing running demands.")
        reasons.append("A shorter, easy session reduces today's demands.")
    if checkin["available_minutes"] < checkin["planned_minutes"] and action != "rest":
        action = "adjust"
        reasons.append("The session is shortened to fit your available time.")
    if not reasons:
        reasons.append("Your check-in gives no clear reason to change the planned session.")
    intensity = {
        "rest": "No run suggested today.",
        "easy": "Comfortable, conversational effort.",
        "long": "Keep the run comfortable and conversational.",
        "tempo": "Follow the controlled, sustained effort in your existing plan.",
        "intervals": "Follow your existing plan's work and recovery intervals.",
    }[kind]
    return {
        "action": action, "session_type": kind, "minutes": minutes,
        "intensity": intensity, "reasons": reasons, "uncertainty": uncertainty,
        "states": {
            "systemic": "concerns" if systemic else ("incomplete" if sleep is None else "no reported concerns"),
            "local": checkin["soreness"],
            "load": "recent demands" if demanding or higher_load else checkin["recent_load"],
            "performance": "not assessed",
        },
        "rule_version": "prototype-1",
    }


def run_input(data):
    if not isinstance(data, dict):
        raise ValidationError("Enter a JSON object.")
    session_id = number(data, "session_id", 1, 2**31)
    if not session_id.is_integer():
        raise ValidationError("session_id: enter a whole number.")
    return {
        "session_id": int(session_id),
        "minutes": number(data, "minutes", 1, 600),
        "distance_km": number(data, "distance_km", 0.01, 300),
        "effort": number(data, "effort", 1, 10),
        "choice": choice(data, "choice", ("recommendation", "original", "other")),
        "notes": text_field(data, "notes"),
    }
