# Suru

Suru helps experienced runners decide what run makes sense today, using their
body condition, recent training, recovery, and available time. The product
direction supports race preparation and general fitness, with user-supplied or
customizable generated plans.

Today starts with a **guided daily body check-in**, then suggests an easy run,
a shorter easy run, or recovery. The runner does not need to select a workout
first. This prototype does not yet generate training plans, harder workouts,
interval structures, or race paces.

## Start here: understanding the code

Start with **one user action: completing today's check-in**. Follow that action
through the files instead of reading every file from top to bottom. The first
goal is to explain what each part does, not to understand every line of Python.

### The three parts of Suru

| Part | Where it runs | What it does |
| --- | --- | --- |
| Frontend | Your web browser | Shows questions, handles clicks, displays suggestions |
| Backend | A Python process on your computer | Receives requests, validates answers, calculates suggestions, reads and saves data |
| Database | `data/suru.sqlite3` on your computer | Remembers profiles, check-ins, suggestions, and completed runs across restarts |

```text
Browser                       Python backend                 Database
HTML + CSS + JavaScript  <-->  server + application logic <--> SQLite file
```

The frontend and backend communicate using HTTP requests. JSON is the data
format sent between them. An API endpoint is a URL the frontend can call to
request data or submit answers; it is not necessarily a file in the repository.
For example, `/api/history` is handled inside `server.py`, not a folder named `api`.

### The folder map

```text
Suru-/
  README.md                This guide, setup, and current limitations
  suru/                    The application
    server.py              Starts the server and routes requests
    daily.py               Validates body check-ins and chooses daily suggestions
    domain.py              Shared validators, profile/run validation, older rules
    storage.py             Reads and writes SQLite records
    static/                Files sent to the browser
      index.html           Today's questions and result containers
      app.js               Today's navigation, submission, and result display
      history.html         History page structure
      history.js           Journal cards and past-run interactions
      profile.html         Profile setup structure
      profile.js           Profile question navigation and saving
      run-log.js           Shared request and run-form helpers used by History
      style.css            Shared visual styles
      onboarding.css       Profile and daily question-card styles
  tests/                   Python tests and browser checks
  data/                    Local database and logs; excluded from Git
```

The root `hrv.py`, `sleep.py`, `resting_hr.py`, and `subjective.py` files are early
experiments. The running app does not call them. Leave those, tests, database
internals, and the older manual-plan rules until the main flow makes sense.

### Trace one check-in

1. **`static/index.html`: find `id="checkin-form"`.** This defines the questions.
   Input `name` attributes, such as `sleep_hours`, become keys in the submitted
   data. The script tag loads `app.js`; it does not execute Python in the browser.
2. **`static/app.js`: find `showStep()`.** It shows one question panel and hides
   the others. Continue moves between cards without contacting the backend.
3. **In the same file, find `form.addEventListener("submit", ...)`.** On the final
   question it collects the answers with `FormData` and calls
   `api("/api/daily-checkins", data)`. The `api()` helper uses `fetch()` to send JSON.
4. **`server.py`: find `/api/daily-checkins` inside `do_POST()`.** The server reads
   JSON into Python data, passes it to `daily_input()`, then calls
   `store.add_daily_session(...)`. Start with this branch; skip headers and
   server-startup internals on the first reading.
5. **`daily.py`: read `daily_input()`.** This checks the answers and returns a
   clean dictionary. Invalid inputs raise `ValidationError`; the server sends
   an error response instead of saving the check-in.
6. **`storage.py`: read `add_daily_session()`.** It loads the profile and recent
   completed runs, then calls `suggest_daily(checkin, profile, runs)`.
7. **`daily.py`: read `suggest_daily()`.** This chooses easy running or recovery
   and returns duration, effort guidance, reasons, uncertainty, and a rule version.
   It does not save to the database. The current rules are provisional.
8. **Back in `storage.py`.** The method saves the check-in, profile snapshot, and
   recommendation, then returns the saved session. The server sends it as JSON.
9. **Back in `app.js`: find `showResult(session)`.** It updates the result elements
   in the HTML. This is where the runner finally sees the suggestion.

```text
Questions -> browser collects answers -> POST /api/daily-checkins
  -> validate -> load context -> calculate -> save -> JSON response
  -> browser displays the suggestion
```

Two separate activities happen here: **calculation** makes the suggestion;
**storage** remembers it. CSS changes appearance but does not change the rules.
Python sends data; JavaScript decides how to put that data onto the page.

### A manageable reading order

Use the trace above over several sittings:

1. `index.html` + `app.js`: understand the questions, Continue button, and result.
2. The daily-check-in branch of `server.py`: understand one request and response.
3. `daily.py`: understand validation and how a suggestion is chosen.
4. `storage.py`: understand why data survives a page refresh or server restart.
5. Profile, History, shared helpers, and tests after that.

Before moving on, answer: **What enters this function, what does it do, and what
comes out?** You do not need to memorize it or understand every helper yet.

### Where to make a change

| Change | Start with |
| --- | --- |
| Reword a Today question | `static/index.html` |
| Change Continue/Back behaviour | `showStep()` and submit listener in `static/app.js` |
| Change the result's displayed wording | `showResult()` in `static/app.js` |
| Change which daily answers are accepted | `daily_input()` in `daily.py` |
| Change what run is suggested | `suggest_daily()` in `daily.py`, then `tests/test_daily.py` |
| Change saving or loading | The relevant method in `storage.py` |
| Add a page or endpoint | `STATIC_ROUTES`, `do_GET()`, or `do_POST()` in `server.py` |
| Change card appearance | The relevant classes in `style.css` or `onboarding.css` |

Edit one behaviour at a time. HTML/CSS/JavaScript changes need a save and browser
refresh. Python changes need a server restart: this server has no automatic
reload. A loading screen can mean a script or API request failed; it does not
necessarily mean the database is empty. Check the browser's Console and Network
tabs and the server terminal/logs before rewriting code.

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
   Older manually planned sessions remain in History's journal cards.
   Profile setup remains separate from the daily check-in.

## Architecture

The app has three main pages: **Today** for today's check-in, suggestion, and run
log; **History** for reviewing the journal and adding past runs; and **Profile**
for goals and availability. Today restores only the current day's latest check-in.
Older sessions remain in History. A rest suggestion requires no completed-run log.
Detailed recovery context stays collapsed until requested on Today and History.

**Run setting** is separate from the session type: choose Outdoor or Treadmill
on Today or when adding a past run. It is saved and shown in History; it does not
change recommendation rules. Older records retain an unrecorded setting.

- `suru/domain.py`: input validation and a pure recommendation function.
- `suru/daily.py`: body-check-in validation and a pure daily session selector.
- `suru/storage.py`: SQLite transactions, history, and persisted rule versions.
- `suru/server.py`: local HTTP API and an explicit static-file allowlist.
- `suru/static/`: responsive, accessible-label web interface; no build step.
- `suru/static/run-log.js`: shared API requests and run-form saving/retry behaviour.
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
node --check suru/static/history.js
node --check suru/static/run-log.js
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

## History timeline

Open `/history` for a vertical journal, newest first, grouped by month and date.
Cards show completed runs, pending logs, or rest recommendations. Expand a card
to review its original plan, recommendation, reasons, check-in, and actual result.
Pending runs can be logged directly in the card; rest recommendations need no log.
Days without check-ins or activities are omitted. The journal currently shows up
to 100 recent check-ins and 100 added runs; older-history pagination is a future increment.

Run `node tests/browser_history.mjs` for isolated Edge checks covering the timeline,
logging and retry, persistence, keyboard access, and phone widths. It uses a temporary
database and does not change your real journal.

History also offers **Log a past run** for completed runs without a check-in.
Enter the run date (today or earlier), run type, duration, distance, effort, and
optional notes. Added runs appear alongside check-ins, clearly labelled without
a recommendation, and inform the next check-in's recent-training context.
If a run already has a check-in, log from that card to avoid recording it twice.
The browser history test covers this flow, including validation and save retry.

Run `node tests/browser_today.mjs` to check the daily flow, restoring a completed
run after reload, isolation from yesterday's check-ins, rest suggestions, save
retry, shared navigation, and mobile width. It also uses a temporary database.

## Next increments

- Structured, editable multi-day plans using the saved runner profile.
- Run completion/editing and an explicit skipped-session outcome.
- Goal-specific plan generation with reviewed workout templates.
- Baseline and trend assessment after suitable history is available.
- Export/deletion controls and schema migrations before storage evolves.
- Before hosting: authentication, authorization, deployment hardening, operational
  monitoring, and privacy controls appropriate to the collected data.
