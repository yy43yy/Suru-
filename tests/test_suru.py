import json
import sqlite3
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from suru.domain import ValidationError, profile_input, recommend, run_input, session_input
from suru.server import handler_for
from suru.storage import Store


def checkin(**changes):
    return session_input({
        "date": "2026-10-09", "goal": "race", "session_type": "intervals",
        "planned_minutes": 50, "available_minutes": 60, "sleep_hours": 8,
        "energy": "normal", "fatigue": "low", "soreness": "none",
        "recent_load": "usual", **changes,
    })


class ProfileTests(unittest.TestCase):
    def test_valid_profile_normalizes_day_order(self):
        result = profile_input({"goal":"race", "weekly_distance_km":"35.5",
                                "running_days":["sun", "tue"], "long_run_day":"sun"})
        self.assertEqual(result["weekly_distance_km"], 35.5)
        self.assertEqual(result["running_days"], ["tue", "sun"])
        self.assertEqual(result["long_run_day"], "sun")

    def test_long_run_preference_is_optional(self):
        for value in (None, ""):
            result = profile_input({"goal":"fitness", "weekly_distance_km":0,
                                    "running_days":["mon"], "long_run_day":value})
            self.assertIsNone(result["long_run_day"])

    def test_invalid_profiles_are_rejected(self):
        valid = {"goal":"fitness", "weekly_distance_km":30, "running_days":["mon"], "long_run_day":None}
        invalid = [{"running_days":[]}, {"running_days":"mon"}, {"running_days":["mon","mon"]},
                   {"running_days":["noday"]}, {"running_days":[[]]}, {"long_run_day":"sun"},
                   {"weekly_distance_km":-1}, {"weekly_distance_km":"NaN"}, {"weekly_distance_km":True},
                   {"goal":"other"}]
        for changes in invalid:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                profile_input({**valid, **changes})
        with self.assertRaises(ValidationError):
            profile_input([])


class RecommendationTests(unittest.TestCase):
    def test_run_setting_is_separate_from_session_and_does_not_change_rules(self):
        outdoor = checkin(setting="outdoor", session_type="tempo")
        treadmill = checkin(setting="treadmill", session_type="tempo")
        self.assertEqual(treadmill["setting"], "treadmill")
        self.assertEqual(treadmill["session_type"], "tempo")
        self.assertEqual(recommend(outdoor, []), recommend(treadmill, []))
        with self.assertRaises(ValidationError):
            checkin(setting="track")

    def test_normal_day_preserves_plan(self):
        result = recommend(checkin(), [])
        self.assertEqual((result["action"], result["session_type"], result["minutes"]), ("follow", "intervals", 50))

    def test_combined_fatigue_and_load_support_rest(self):
        result = recommend(checkin(sleep_hours=5, fatigue="high", recent_load="higher"), [])
        self.assertEqual((result["action"], result["minutes"]), ("rest", 0))

    def test_local_soreness_can_change_run_with_good_systemic_state(self):
        result = recommend(checkin(soreness="significant"), [])
        self.assertEqual(result["session_type"], "easy")
        self.assertEqual(result["states"]["systemic"], "no reported concerns")

    def test_time_constraint_is_respected(self):
        result = recommend(checkin(available_minutes=20), [])
        self.assertEqual((result["action"], result["minutes"]), ("adjust", 20))

    def test_isolated_hrv_does_not_change_recommendation(self):
        low = recommend(checkin(hrv=10), [])
        high = recommend(checkin(hrv=150), [])
        self.assertEqual(low["action"], high["action"])
        self.assertTrue(any("one reading" in message for message in low["uncertainty"]))

    def test_missing_sleep_is_explicit(self):
        result = recommend(checkin(sleep_hours=None), [])
        self.assertEqual(result["states"]["systemic"], "incomplete")
        self.assertTrue(any("Sleep was not provided" in s for s in result["uncertainty"]))

    def test_pain_pauses_running(self):
        self.assertEqual(recommend(checkin(soreness="pain"), [])["session_type"], "rest")

    def test_only_prior_recent_runs_affect_load(self):
        future = [{"date":"2026-10-10", "effort":9}]
        old = [{"date":"2026-10-01", "effort":9}]
        recent = [{"date":"2026-10-08", "effort":9}]
        self.assertEqual(recommend(checkin(), future)["action"], "follow")
        self.assertEqual(recommend(checkin(), old)["action"], "follow")
        self.assertEqual(recommend(checkin(), recent)["session_type"], "easy")

    def test_invalid_inputs_are_rejected(self):
        for changes in ({"sleep_hours":-1}, {"hrv":"NaN"}, {"planned_minutes":True},
                        {"date":"bad"}, {"energy":"unknown"}, {"notes":[]}, {"available_minutes":"Infinity"}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                checkin(**changes)
        with self.assertRaises(ValidationError):
            session_input([])


class EndToEndTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = Path(self.temp.name) / "test.sqlite3"
        self.store = Store(self.db)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.store))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.url = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def request(self, path, data=None, headers=None):
        req = Request(self.url + path, data=None if data is None else json.dumps(data).encode(),
                      headers=headers or {"Content-Type":"application/json"})
        try:
            with urlopen(req, timeout=5) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            with error:
                return error.code, json.load(error)

    def test_complete_loop_survives_reopening_and_informs_next_day(self):
        code, session = self.request("/api/sessions", checkin(date="2026-10-08"))
        self.assertEqual(code, 201)
        code, run = self.request("/api/runs", {"session_id":session["id"], "minutes":50,
                                                 "distance_km":9, "effort":8, "choice":"original", "notes":"Hard session"})
        self.assertEqual(code, 201)
        persisted = Store(self.db).history()
        self.assertEqual(persisted["runs"][0]["id"], run["id"])
        self.assertEqual(persisted["sessions"][0]["recommendation"]["rule_version"], "prototype-1")
        code, next_day = self.request("/api/sessions", checkin())
        self.assertEqual(next_day["recommendation"]["session_type"], "easy")
        code, journal = self.request("/api/history")
        self.assertEqual(code, 200)
        self.assertEqual(len(journal["sessions"]), 2)
        self.assertEqual(len(journal["runs"]), 1)

    def test_edit_run_preserves_identity_and_updates_future_training_context(self):
        session = self.store.add_session(checkin(date="2026-10-08"))
        original = {"session_id":session["id"], "minutes":30, "distance_km":5, "effort":4, "choice":"recommendation", "notes":"Easy"}
        _, saved = self.request("/api/runs", original)
        changes = {**original, "minutes":40, "distance_km":6.2, "effort":8, "choice":"other", "notes":"Corrected effort"}
        code, updated = self.request("/api/runs/update", changes)
        self.assertEqual(code, 200)
        self.assertEqual(updated["id"], saved["id"])
        self.assertEqual(updated["date"], saved["date"])
        reopened = Store(self.db).history()
        self.assertEqual(len(reopened["runs"]), 1)
        for key, value in changes.items():
            self.assertEqual(reopened["runs"][0][key], value)
        self.assertEqual(reopened["sessions"][0]["recommendation"], session["recommendation"])
        _, next_day = self.request("/api/sessions", checkin())
        self.assertEqual(next_day["recommendation"]["session_type"], "easy")

    def test_invalid_edit_does_not_replace_or_create_a_run(self):
        session = self.store.add_session(checkin())
        original = {"session_id":session["id"], "minutes":30, "distance_km":5, "effort":4, "choice":"recommendation"}
        self.request("/api/runs", original)
        before = self.store.history()["runs"]
        for changes in ({"minutes":0}, {"distance_km":-1}, {"effort":11}, {"choice":"invalid"}, {"notes":[]}):
            self.assertEqual(self.request("/api/runs/update", {**original, **changes})[0], 400)
        self.assertEqual(self.request("/api/runs/update", {**original, "session_id":999})[0], 400)
        pending = self.store.add_session(checkin())
        self.assertEqual(self.request("/api/runs/update", {**original, "session_id":pending["id"]})[0], 400)
        self.assertEqual(self.store.history()["runs"], before)

    def test_duplicate_log_and_nonexistent_session_rejected(self):
        session = self.store.add_session(checkin())
        run = {"session_id":session["id"], "minutes":30, "distance_km":5, "effort":4, "choice":"recommendation"}
        self.assertEqual(self.request("/api/runs",run)[0], 201)
        self.assertEqual(self.request("/api/runs",run)[0], 400)
        self.assertEqual(self.request("/api/runs",{**run,"session_id":999})[0], 400)

    def test_setting_persists_in_checkins_and_past_runs(self):
        code, session = self.request("/api/sessions", checkin(setting="treadmill"))
        self.assertEqual(code, 201)
        self.assertEqual(session["checkin"]["setting"], "treadmill")
        activity = {"date":"2026-10-08", "session_type":"easy", "setting":"treadmill",
                    "minutes":30,"distance_km":5,"effort":4}
        self.assertEqual(self.request("/api/activities",activity)[0], 201)
        self.assertEqual(self.request("/api/activities",{**activity,"setting":"invalid"})[0], 400)
        reopened = Store(self.db).history()
        self.assertEqual(reopened["sessions"][0]["checkin"]["setting"], "treadmill")
        self.assertEqual(reopened["activities"][0]["setting"], "treadmill")

    def test_old_activity_database_upgrades_without_guessing_setting(self):
        legacy = Path(self.temp.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy) as db:
            db.execute("""CREATE TABLE activities (
                id INTEGER PRIMARY KEY, date TEXT NOT NULL, session_type TEXT NOT NULL,
                minutes REAL NOT NULL, distance_km REAL NOT NULL, effort REAL NOT NULL,
                notes TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)""")
            db.execute("INSERT INTO activities(date,session_type,minutes,distance_km,effort,notes) VALUES ('2026-10-08','easy',30,5,4,'Existing run')")
        db.close()
        Store(legacy)
        history = Store(legacy).history()
        self.assertEqual(len(history["activities"]), 1)
        self.assertIsNone(history["activities"][0]["setting"])
        self.assertEqual(history["activities"][0]["notes"], "Existing run")

    def test_past_activity_persists_without_checkin_and_informs_next_day(self):
        activity = {"date":"2026-10-08", "session_type":"tempo", "minutes":40,
                    "distance_km":7, "effort":8, "notes":"Track session"}
        code, saved = self.request("/api/activities", activity)
        self.assertEqual(code, 201)
        reopened = Store(self.db).history()
        self.assertEqual(reopened["sessions"], [])
        self.assertEqual(reopened["runs"], [])
        self.assertEqual(reopened["activities"][0]["id"], saved["id"])
        self.assertEqual(reopened["activities"][0]["date"], "2026-10-08")
        self.assertEqual(self.request("/api/history")[1]["activities"][0]["notes"], "Track session")
        _, next_day = self.request("/api/sessions", checkin())
        self.assertEqual(next_day["recommendation"]["session_type"], "easy")
        self.assertTrue(any("demanding run" in reason for reason in next_day["recommendation"]["reasons"]))

    def test_invalid_past_activities_do_not_write_history(self):
        activity = {"date":"2026-10-08", "session_type":"easy", "minutes":30,
                    "distance_km":5, "effort":4, "notes":""}
        for changes in ({"date":"bad"}, {"date":"2999-01-01"}, {"minutes":0},
                        {"distance_km":-1}, {"effort":11}, {"session_type":"cycling"},
                        {"minutes":"NaN"}, {"notes":[]}):
            with self.subTest(changes=changes):
                self.assertEqual(self.request("/api/activities", {**activity, **changes})[0], 400)
        self.assertEqual(self.request("/api/activities", [])[0], 400)
        self.assertEqual(self.store.history()["activities"], [])

    def test_adding_activity_preserves_existing_journal_and_profile(self):
        session = self.store.add_session(checkin())
        self.store.add_run(run_input({"session_id":session["id"], "minutes":30,
                                     "distance_km":5,"effort":4,"choice":"original"}))
        profile = {"goal":"fitness","weekly_distance_km":20,"running_days":["mon"],"long_run_day":None}
        self.store.save_profile(profile)
        code, _ = self.request("/api/activities", {"date":"2026-10-01","session_type":"long",
                                                  "minutes":60,"distance_km":10,"effort":5})
        self.assertEqual(code, 201)
        reopened = Store(self.db)
        self.assertEqual(reopened.get_profile(), profile)
        self.assertEqual(len(reopened.history()["runs"]), 1)
        self.assertEqual(len(reopened.history()["sessions"]), 1)

    def test_request_validation_and_origin(self):
        self.assertEqual(self.request("/api/sessions",[])[0], 400)
        self.assertEqual(self.request("/api/sessions",checkin(), {"Content-Type":"text/plain"})[0], 415)
        self.assertEqual(self.request("/api/sessions",checkin(), {"Content-Type":"application/json", "Origin":"http://other.example"})[0], 403)
        self.assertEqual(self.request("/api/missing")[0], 404)

    def test_frontend_assets_are_served_with_security_headers(self):
        for path, content_type in (("/","text/html"),("/profile","text/html"),("/history","text/html"),("/history.js","text/javascript"),("/run-log.js","text/javascript"),("/profile.js","text/javascript"),("/app.js","text/javascript"),("/style.css","text/css"),("/onboarding.css","text/css")):
            with self.subTest(path=path), urlopen(self.url+path, timeout=5) as response:
                self.assertEqual(response.status, 200)
                self.assertTrue(response.headers["Content-Type"].startswith(content_type))
                self.assertIn("frame-ancestors 'none'",response.headers["Content-Security-Policy"])
                self.assertTrue(response.read())

    def test_profile_setup_edit_and_restart_preserve_history(self):
        self.assertEqual(self.request("/api/profile"), (200, {"profile":None}))
        session = self.store.add_session(checkin())
        original = {"goal":"race", "weekly_distance_km":35, "running_days":["tue","sun"], "long_run_day":"sun"}
        self.assertEqual(self.request("/api/profile", original), (200, {"profile":original}))
        self.assertEqual(self.request("/api/profile")[1]["profile"], original)
        self.assertEqual(Store(self.db).get_profile(), original)
        edited = {**original, "goal":"fitness", "weekly_distance_km":40, "long_run_day":None}
        self.assertEqual(self.request("/api/profile", edited)[0], 200)
        reopened = Store(self.db)
        self.assertEqual(reopened.get_profile(), edited)
        self.assertEqual(reopened.history()["sessions"][0]["id"], session["id"])
        with reopened.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM runner_profile").fetchone()[0], 1)

    def test_invalid_profile_update_does_not_replace_saved_profile(self):
        valid = {"goal":"fitness", "weekly_distance_km":20, "running_days":["mon"], "long_run_day":None}
        self.request("/api/profile", valid)
        code, error = self.request("/api/profile", {**valid, "long_run_day":"sun"})
        self.assertEqual(code, 400)
        self.assertIn("available running days", error["error"])
        self.assertEqual(self.store.get_profile(), valid)


if __name__ == "__main__":
    unittest.main()
