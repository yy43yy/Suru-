"""SQLite persistence; each operation owns its connection and transaction."""
import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path

from .domain import ValidationError, recommend


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id INTEGER PRIMARY KEY, date TEXT NOT NULL,
                    checkin TEXT NOT NULL, recommendation TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id INTEGER PRIMARY KEY,
                    session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id),
                    date TEXT NOT NULL, minutes REAL NOT NULL,
                    distance_km REAL NOT NULL, effort REAL NOT NULL,
                    choice TEXT NOT NULL, notes TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS runs_date ON runs(date);
                CREATE TABLE IF NOT EXISTS activities (
                    id INTEGER PRIMARY KEY, date TEXT NOT NULL,
                    session_type TEXT NOT NULL, minutes REAL NOT NULL,
                    distance_km REAL NOT NULL, effort REAL NOT NULL,
                    notes TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS activities_date ON activities(date);
                CREATE TABLE IF NOT EXISTS runner_profile (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    profile TEXT NOT NULL,
                    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
            """)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def get_profile(self):
        with self.connect() as db:
            row = db.execute("SELECT profile FROM runner_profile WHERE id = 1").fetchone()
        return json.loads(row["profile"]) if row else None

    def save_profile(self, profile):
        # One editable profile for this local, single-user app.
        with self.connect() as db:
            db.execute("""INSERT INTO runner_profile(id, profile) VALUES (1, ?)
                          ON CONFLICT(id) DO UPDATE SET
                          profile = excluded.profile, updated_at = CURRENT_TIMESTAMP""",
                       (json.dumps(profile),))
        return profile

    def history(self):
        with self.connect() as db:
            sessions = [dict(r) for r in db.execute("SELECT * FROM sessions ORDER BY date DESC, id DESC LIMIT 100")]
            runs = [dict(r) for r in db.execute("SELECT * FROM runs ORDER BY date DESC, id DESC LIMIT 100")]
            activities = [dict(r) for r in db.execute("SELECT * FROM activities ORDER BY date DESC, id DESC LIMIT 100")]
        for session in sessions:
            session["checkin"] = json.loads(session["checkin"])
            session["recommendation"] = json.loads(session["recommendation"])
        return {"sessions": sessions, "runs": runs, "activities": activities}

    def add_activity(self, activity):
        with self.connect() as db:
            cursor = db.execute(
                """INSERT INTO activities(date, session_type, minutes, distance_km, effort, notes)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                tuple(activity[key] for key in ("date", "session_type", "minutes", "distance_km", "effort", "notes")))
            return {"id": cursor.lastrowid, **activity}

    def add_session(self, checkin):
        with self.connect() as db:
            recent = [dict(r) for r in db.execute("SELECT * FROM runs WHERE date < ? AND date >= date(?, '-2 days')", (checkin["date"], checkin["date"]))]
            recent.extend(dict(r) for r in db.execute("SELECT * FROM activities WHERE date < ? AND date >= date(?, '-2 days')", (checkin["date"], checkin["date"])))
            result = recommend(checkin, recent)
            cursor = db.execute("INSERT INTO sessions(date, checkin, recommendation) VALUES (?, ?, ?)",
                                (checkin["date"], json.dumps(checkin), json.dumps(result)))
            return {"id": cursor.lastrowid, "date": checkin["date"], "checkin": checkin, "recommendation": result}

    def add_run(self, run):
        with self.connect() as db:
            session = db.execute("SELECT date FROM sessions WHERE id = ?", (run["session_id"],)).fetchone()
            if session is None:
                raise ValidationError("The selected session does not exist.")
            try:
                cursor = db.execute("INSERT INTO runs(session_id, date, minutes, distance_km, effort, choice, notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                    (run["session_id"], session["date"], run["minutes"], run["distance_km"], run["effort"], run["choice"], run["notes"]))
            except sqlite3.IntegrityError:
                raise ValidationError("This session already has a run logged.") from None
            return {"id": cursor.lastrowid, "date": session["date"], **run}
