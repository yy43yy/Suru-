# Suru

Suru helps experienced runners decide what run makes sense today, using their
body condition, recent training, recovery, and available time. The product
direction supports race preparation and general fitness, with user-supplied or
customizable generated plans.

Today starts with a **guided daily body check-in**, then suggests an easy run,
a shorter easy run, or recovery. The runner does not need to select a workout
first. This prototype does not yet generate training plans, harder workouts,
interval structures, or race paces.

## Run locally

Requires Python 3.12 or later. No third-party dependencies are needed.

```powershell
python -m suru.server
```

Open <http://127.0.0.1:8000>. To change the port or database:

```powershell
python -m suru.server --port 8001 --database data/suru.sqlite3
```

Stop the server with Ctrl+C. Check-ins and runs survive a restart; they are
stored in `data/suru.sqlite3`, excluded from Git. The server binds only to
127.0.0.1. This is a single-user local prototype, not a hosted production service.

## First working loop

New runners start at `/profile`: choose a goal, typical weekly distance, available
running days, and an optional long-run day. Save to reach Today. Returning runners
go directly to Today and can use **Edit profile** to change these answers. The
single local profile persists across restarts; existing journal records are
preserved. The goal carries into new check-ins. Schedule and distance are saved
as context for the next planning increment, not used to prescribe workouts yet.

Setup presents one question at a time, with progress, Back/Continue navigation,
and an editable review before saving. Answers remain in the form while moving
between questions; they are saved to the database only on the final step.

1. Answer five question cards: sleep (hours and quality), energy, fatigue,
   soreness (including optional location), and available time.
2. Move Back/Continue without losing answers, then request today's suggestion.
3. Read the suggested session, duration, effort guidance, reasons, and limitations.
4. Edit the check-in or log the actual run. Recovery days need no completed run.
5. Reopen Today to see today's most recent saved body-check-in suggestion.
   Completed runs inform subsequent check-ins, including later check-ins that day.
   Older manually planned sessions remain in History, which is still a raw JSON
   learning page. Profile setup remains separate from the daily check-in.

## Architecture

- `suru/domain.py`: input validation and a pure recommendation function.
- `suru/daily.py`: body-check-in validation and a pure daily session selector.
- `suru/storage.py`: SQLite transactions, history, and persisted rule versions.
- `suru/server.py`: local HTTP API and an explicit static-file allowlist.
- `suru/static/`: responsive, accessible-label web interface; no build step.
- `tests/test_suru.py`: scenario, persistence, and HTTP integration tests.

Recommendation rules are provisional product experiments. Daily duration starts
from the median logged run duration over the previous 14 days, capped at 45 minutes,
or a disclosed 20-minute default if there is no history. Available time caps the
suggestion. Shorter runs use 70% of that starting duration. Short sleep currently
means below six hours; sleep quality and hours count as one dimension. A demanding
logged run has effort at least 7/10. These choices are not validated scientific
thresholds or individualized prescriptions; no composite readiness score is used.
Each saved recommendation retains its inputs, reasons, uncertainty, and rule
version so changes can be reviewed. There is no composite readiness score.

The daily form supports unknown answers and optional sleep duration; missing data
is disclosed and suggestions stay light. Soreness location is saved and shown in
the explanation but does not yet produce location-specific rules. Personal HRV
baselines, performance trends, and detailed load estimates are not implemented.
Missing history does not imply recovery. Profile goals are saved as context;
both goal types currently share daily rules. Each body check-in saves a profile
snapshot and rule version. The earlier manual-session API remains available for
existing records and tests; the daily UI no longer requires it. The original
root scoring scripts are not used by the app.

## Checks

```powershell
python -m unittest discover -s tests -v
node --check suru/static/app.js
node --check suru/static/profile.js
```

Tests use temporary databases and cover the full HTTP check-in → recommendation
→ run log → next-day feedback loop, input validation, missing data, isolated HRV,
pain, time constraints, and duplicate logs. Node is optional for the app; it is
only used here to syntax-check the frontend.

For the onboarding browser smoke test on Windows with Microsoft Edge installed:

```powershell
node tests/browser_profile.mjs
```

This starts an isolated server and temporary database, runs headless Edge, and
checks required answers, Back navigation, review/edit, dependent weekday options,
failed-save retry, successful save, returning-user editing, and mobile width.
It does not change your real profile or journal. Set `SURU_EDGE` if Edge is
installed at a different path.

## Next increments

- Structured, editable multi-day plans using the saved runner profile.
- Run completion/editing and an explicit skipped-session outcome.
- Goal-specific plan generation with reviewed workout templates.
- Baseline and trend assessment after suitable history is available.
- Export/deletion controls and schema migrations before storage evolves.
- Before hosting: authentication, authorization, deployment hardening, operational
  monitoring, and privacy controls appropriate to the collected data.
