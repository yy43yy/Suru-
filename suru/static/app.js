"use strict";
const $ = id => document.getElementById(id);
const {api, bindRunLog} = window.Suru;
const labels = {easy:"Easy run",long:"Long run",tempo:"Tempo run",intervals:"Intervals",rest:"Recovery day"};
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
let history = {sessions:[], runs:[]};
let selectedId = null;
let loading = true;

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
  $("recommendation-date").textContent = `Planned: ${labels[session.checkin.session_type]} · ${session.checkin.planned_minutes} min`;
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
  if (run) $("log-complete").textContent = `Run logged · ${run.distance_km} km in ${run.minutes} min · Effort ${run.effort}/10. View it in History.`;
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

bindRunLog($("log-form"), {
  message: $("log-status"),
  onSaved(run) {
    history.runs.unshift(run);
    if (run.session_id === selectedId) showSession(history.sessions.find(session => session.id === selectedId));
    status("checkin-status", "Run saved. You can review it in History.");
    $("log-complete").focus({preventScroll:true});
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
