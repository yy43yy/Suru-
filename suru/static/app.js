"use strict";
const $ = id => document.getElementById(id);
const {api, bindRunLog, settingLabel} = window.Suru;
const labels = {easy:"Easy run",long:"Long run",tempo:"Tempo run",intervals:"Intervals",rest:"Recovery day"};
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
let history = {sessions:[], runs:[]};
let selectedId = null;
let loading = true;
let editingRun = false;

function node(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}
function list(id, items) { $(id).replaceChildren(...items.map(item => node("li", item))); }

function showSession(session, scroll = false) {
  selectedId = session.id;
  const rec = session.recommendation;
  $("recommendation-empty").hidden = true;
  $("recommendation-content").hidden = false;
  $("recommendation-date").textContent = `Planned: ${labels[session.checkin.session_type]} · ${session.checkin.planned_minutes} min · ${settingLabel(session.checkin.setting)}`;
  $("action").textContent = {follow:"FOLLOW YOUR PLAN",adjust:"ADAPT TODAY",rest:"RECOVER TODAY"}[rec.action];
  $("suggested-run").textContent = rec.minutes ? `${rec.minutes} min · ${labels[rec.session_type]}` : "Take a recovery day";
  $("intensity").textContent = rec.intensity;
  $("states").replaceChildren(...Object.entries(rec.states).map(([key,value]) => {
    const element = node("div", "", "state");
    element.append(node("strong", key), node("span", value));
    return element;
  }));
  list("reasons", rec.reasons);
  list("uncertainty", rec.uncertainty);
  const run = history.runs.find(run => run.session_id === session.id);
  $("log-card").hidden = Boolean(run) || rec.action === "rest";
  $("log-complete").hidden = !run;
  if (run) $("log-summary").textContent = `Run logged · ${run.distance_km} km in ${run.minutes} min · Effort ${run.effort}/10. View it in History.`;
  editingRun = false;
  $("log-title").textContent = "How did the run go?";
  $("cancel-edit-run").hidden = true;
  const saveButton = $("log-form").querySelector("button[type=submit]");
  saveButton.disabled = false;
  saveButton.textContent = "Save completed run ✓";
  $("log-form").reset();
  $("session-id").value = session.id;
  status("log-status", "");
  if (scroll) $("recommendation-title").scrollIntoView({behavior:"smooth",block:"start"});
}

$("checkin-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (loading) return;
  const form = event.target;
  const button = form.querySelector("button[type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  status("checkin-status", "Saving…");
  try {
    const session = await api("/api/sessions", Object.fromEntries(new FormData(form)));
    history.sessions.unshift(session);
    showSession(session, true);
    status("checkin-status", "Check-in and recommendation saved.");
  } catch (error) {
    status("checkin-status", error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("edit-run").addEventListener("click", () => {
  const run = history.runs.find(run => run.session_id === selectedId);
  if (!run) return;
  const form = $("log-form");
  for (const name of ["minutes", "distance_km", "effort", "choice", "notes"]) {
    form.elements.namedItem(name).value = run[name] ?? "";
  }
  editingRun = true;
  $("log-complete").hidden = true;
  $("log-card").hidden = false;
  $("log-title").textContent = "Edit completed run";
  $("cancel-edit-run").hidden = false;
  const saveButton = form.querySelector("button[type=submit]");
  saveButton.disabled = false;
  saveButton.textContent = "Save changes";
  status("log-status", "");
  form.elements.minutes.focus();
});

$("cancel-edit-run").addEventListener("click", () => {
  showSession(history.sessions.find(session => session.id === selectedId));
  $("edit-run").focus();
});

bindRunLog($("log-form"), {
  path: () => editingRun ? "/api/runs/update" : "/api/runs",
  message: $("log-status"),
  onSaved(run) {
    const message = editingRun ? "Run updated. You can review it in History." : "Run saved. You can review it in History.";
    history.runs = [run, ...history.runs.filter(saved => saved.id !== run.id)];
    if (run.session_id === selectedId) {
      showSession(history.sessions.find(session => session.id === selectedId));
      $("log-complete").focus({preventScroll:true});
    }
    status("checkin-status", message);
  }
});

$("run-date").value = today;
$("today-date").textContent = now.toLocaleDateString("en-GB", {weekday:"long",day:"numeric",month:"long"});
$("checkin-form").querySelector("button").disabled = true;
async function initialize() {
  const {profile} = await api("/api/profile");
  if (!profile) {
    window.location.replace("/profile");
    return;
  }
  $("checkin-goal").value = profile.goal;
  $("profile-summary").textContent = `${profile.goal === "race" ? "Race preparation" : "General running fitness"} · ${profile.weekly_distance_km} km/week`;
  history = await api("/api/history");
  const currentSession = history.sessions.filter(session => session.date === today).sort((a,b) => b.id - a.id)[0];
  if (currentSession) {
    for (const [key, value] of Object.entries(currentSession.checkin)) {
      const field = $("checkin-form").elements.namedItem(key);
      if (field) field.value = value ?? "";
    }
    showSession(currentSession);
  }
  loading = false;
  $("checkin-form").querySelector("button").disabled = false;
}
initialize().catch(error => {
  status("profile-summary", `Could not load your data: ${error.message}. Reload to try again.`, true);
});
