"use strict";
const $ = (id) => document.getElementById(id);
const labels = {easy:"Easy run",long:"Long run",tempo:"Tempo run",intervals:"Intervals",rest:"Recovery day"};
let history = {sessions:[], runs:[]};
let selectedId = null;
let loading = true;

async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
  return result;
}
function node(tag, text, className) {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  return el;
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
  $("recommendation-date").textContent = `${session.date} · Planned: ${labels[session.checkin.session_type]} / ${session.checkin.planned_minutes} min`;
  $("action").textContent = {follow:"FOLLOW YOUR PLAN",adjust:"ADAPT TODAY",rest:"RECOVER TODAY"}[rec.action];
  $("suggested-run").textContent = rec.minutes ? `${rec.minutes} min · ${labels[rec.session_type]}` : "Take a recovery day";
  $("intensity").textContent = rec.intensity;
  $("states").replaceChildren(...Object.entries(rec.states).map(([key,value]) => {
    const el = node("div", "", "state");
    el.append(node("strong", key), node("span", value));
    return el;
  }));
  list("reasons", rec.reasons); list("uncertainty", rec.uncertainty);
  const logged = history.runs.some(run => run.session_id === session.id);
  $("log-card").hidden = logged;
  $("log-form").reset();
  $("log-form").querySelector("button").hidden = false;
  $("session-id").value = session.id;
  status("log-status", "");
  if (scroll) $("recommendation-title").scrollIntoView({behavior:"smooth",block:"start"});
}
function renderHistory() {
  if (!history.sessions.length) {
    $("history-list").replaceChildren(node("div", "Your first check-in starts your journal. Completed runs will help inform future suggestions.", "history-empty"));
    return;
  }
  $("history-list").replaceChildren(...history.sessions.map(session => {
    const row = node("div", "", "history-row");
    const body = node("div", "");
    body.append(node("strong", `${labels[session.recommendation.session_type]}${session.recommendation.minutes ? ` · ${session.recommendation.minutes} min suggested` : ""}`));
    const run = history.runs.find(r => r.session_id === session.id);
    body.append(node("p", run ? `Completed ${run.distance_km} km in ${run.minutes} min · Effort ${run.effort}/10 · ${ {recommendation:"Followed suggestion",original:"Followed original plan",other:"Chose another session"}[run.choice]}` : "Check-in saved · No completed run logged"));
    if (session.checkin.notes) body.append(node("p", `Check-in: ${session.checkin.notes}`, "history-note"));
    if (run?.notes) body.append(node("p", `Run: ${run.notes}`, "history-note"));
    const button = node("button", run ? "View" : "View / log");
    button.type = "button";
    button.addEventListener("click", () => showSession(session,true));
    row.append(node("span",session.date),body,button);
    return row;
  }));
}
async function refresh() {
  history = await api("/api/history");
  renderHistory();
}
async function submit(form, statusId, work) {
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  status(statusId,"Saving…");
  try { await work(Object.fromEntries(new FormData(form))); }
  catch (error) { status(statusId,error.message,true); }
  finally { button.disabled = false; }
}
$("checkin-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (loading) return;
  await submit(event.target,"checkin-status",async data => {
    const session = await api("/api/sessions",data);
    history.sessions.unshift(session);
    renderHistory(); showSession(session,true);
    status("checkin-status","Check-in and recommendation saved.");
  });
});
$("log-form").addEventListener("submit", async event => {
  event.preventDefault();
  await submit(event.target,"log-status",async data => {
    const run = await api("/api/runs",data);
    history.runs.unshift(run);
    renderHistory();
    status("log-status","Run saved. Your next check-in will consider this session.");
    event.target.querySelector("button").hidden = true;
  });
});
const now = new Date();
$("run-date").value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
$("checkin-form").querySelector("button").disabled = true;
refresh().then(() => {
  if (history.sessions.length) showSession(history.sessions[0]);
}).catch(error => status("history-status",`Could not load history: ${error.message}. Reload to try again.`,true)).finally(() => {
  loading = false;
  $("checkin-form").querySelector("button").disabled = false;
});
