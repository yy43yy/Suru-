import unittest

from suru.daily import daily_input, suggest_daily
from suru.domain import ValidationError
import test_suru


PROFILE = {"goal": "race", "weekly_distance_km": 30, "running_days": ["tue", "sun"], "long_run_day": "sun"}


def daily(**changes):
    return daily_input({"date": "2026-10-18", "sleep_hours": 8, "sleep_quality": "good",
                        "energy": "normal", "fatigue": "low", "soreness": "none",
                        "available_minutes": 30, **changes})


class DailySuggestionTests(unittest.TestCase):
    def test_no_planned_workout_is_required(self):
        result = suggest_daily(daily(), PROFILE, [])
        self.assertEqual(result["session_type"], "easy")
        self.assertEqual(result["minutes"], 20)
        self.assertTrue(any("provisional default" in reason for reason in result["uncertainty"]))

    def test_combined_signals_reduce_demands(self):
        normal = suggest_daily(daily(), PROFILE, [])
        tired = suggest_daily(daily(sleep_hours=5, sleep_quality="poor", energy="low"), PROFILE, [])
        self.assertLess(tired["minutes"], normal["minutes"])
        self.assertEqual(tired["session_type"], "easy")

    def test_sleep_duration_and_quality_are_one_dimension(self):
        result = suggest_daily(daily(sleep_hours=5, sleep_quality="poor"), PROFILE, [])
        self.assertEqual(result["minutes"], 20)

    def test_pain_and_no_available_time_suggest_recovery(self):
        for changes in ({"soreness": "pain", "soreness_area": "left knee"}, {"available_minutes": 0}):
            with self.subTest(changes=changes):
                result = suggest_daily(daily(**changes), PROFILE, [])
                self.assertEqual((result["session_type"], result["minutes"]), ("rest", 0))

    def test_soreness_and_combined_fatigue_support_recovery(self):
        result = suggest_daily(daily(soreness="significant", energy="low", fatigue="high"), PROFILE, [])
        self.assertEqual(result["session_type"], "rest")

    def test_recent_history_anchors_duration_and_limits_time(self):
        runs = [{"date": "2026-10-14", "minutes": 40, "effort": 4}]
        self.assertEqual(suggest_daily(daily(available_minutes=60), PROFILE, runs)["minutes"], 40)
        self.assertEqual(suggest_daily(daily(available_minutes=10), PROFILE, runs)["minutes"], 10)
        future = [{"date": "2026-10-19", "minutes": 200, "effort": 10}]
        self.assertEqual(suggest_daily(daily(), PROFILE, future)["minutes"], 20)

    def test_missing_data_is_explicit_and_keeps_session_light(self):
        result = suggest_daily(daily(sleep_hours=None, energy="unknown"), PROFILE, [])
        self.assertEqual(result["session_type"], "easy")
        self.assertLess(result["minutes"], 20)
        self.assertTrue(any("energy is unknown" in reason for reason in result["uncertainty"]))

    def test_a_run_already_completed_today_also_counts(self):
        runs = [{"date": "2026-10-18", "minutes": 40, "effort": 8}]
        result = suggest_daily(daily(energy="low", fatigue="high"), PROFILE, runs)
        self.assertEqual(result["session_type"], "rest")

    def test_invalid_inputs_and_soreness_notes(self):
        for changes in ({"sleep_quality": "amazing"}, {"available_minutes": -1}, {"date": "bad"},
                        {"sleep_hours": "NaN"}, {"soreness": "pain", "soreness_area": "a" * 81}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                daily(**changes)
        self.assertEqual(daily(soreness_area="old soreness")["soreness_area"], "")


class DailyHTTPTests(unittest.TestCase):
    # Reuse the real HTTP server fixture without duplicating its regression tests.
    setUp = test_suru.EndToEndTests.setUp
    tearDown = test_suru.EndToEndTests.tearDown
    request = test_suru.EndToEndTests.request
    def test_daily_checkin_saves_snapshot_and_closes_feedback_loop(self):
        self.request("/api/profile", PROFILE)
        code, session = self.request("/api/daily-checkins", daily())
        self.assertEqual(code, 201)
        self.assertNotIn("planned_minutes", session["checkin"])
        self.assertEqual(session["checkin"]["source"], "body_checkin")
        self.assertEqual(session["checkin"]["profile"], PROFILE)
        self.assertEqual(session["recommendation"]["rule_version"], "daily-prototype-1")
        code, run = self.request("/api/runs", {"session_id": session["id"], "minutes": 35,
                                                "distance_km": 5, "effort": 8, "choice": "other"})
        self.assertEqual(code, 201)
        code, tomorrow = self.request("/api/daily-checkins", daily(date="2026-10-19", sleep_hours=5, energy="low"))
        self.assertEqual(code, 201)
        self.assertEqual(tomorrow["recommendation"]["session_type"], "rest")
        self.assertTrue(any("demanding run" in text for text in tomorrow["recommendation"]["reasons"]))

    def test_profile_required_and_invalid_inputs_do_not_save(self):
        self.assertEqual(self.request("/api/daily-checkins", daily())[0], 400)
        self.request("/api/profile", PROFILE)
        self.assertEqual(self.request("/api/daily-checkins", {**daily(), "energy": "invalid"})[0], 400)
        self.assertEqual(self.store.history()["sessions"], [])
