"use strict";
const $ = id => document.getElementById(id);
const form = $("checkin-form");
const panels = Array.from(form.querySelectorAll(".question-panel"));
let step = 0;
let busy = false;
let activeSession = null;
let runs = [];

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
}
async function api(path, data) {
  const response = await fetch(path, data === undefined ? {} : {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Unable to load or save. Please try again.");
  return body;
}
function status(id, text, error = false) {
  $(id).textContent = text;
  $(id).classList.toggle("error", error);
}
function setSorenessArea() {
  $("soreness-area-label").hidden = !["mild","significant","pain"].includes(form.elements.soreness.value);
}
function showStep(index, focus = true) {
  step = index;
  panels.forEach((panel,i) => { panel.hidden = i !== index; });
  $("daily-back").hidden = index === 0;
  $("daily-step-label").textContent = `Question ${index+1} of 5`;
  $("daily-progress").value = index+1;
  $("daily-next").textContent = index === 4 ? "See today’s suggestion ↗" : "Continue →";
  status("checkin-status", "");
  if (focus) panels[index].querySelector("h2").focus();
}
function list(id, values) {
  $(id).replaceChildren(...values.map(value => {const li = document.createElement("li");li.textContent = value;return li;}));
}
function showResult(session, focus = true) {
  activeSession = session;
  const rec = session.recommendation;
  $("daily-flow").hidden = true;
  $("daily-result").hidden = false;
  $("log-card").hidden = true;
  $("recommendation-date").textContent = `${session.date} / YOUR SUGGESTION`;
  $("action").textContent = rec.session_type === "rest" ? "ROOM TO RECOVER" : "KEEP IT COMFORTABLE";
  $("recommendation-title").textContent = rec.session_type === "rest" ? "Make today a recovery day." : `${rec.minutes}-minute easy run`;
  $("intensity").textContent = rec.intensity;
  list("reasons",rec.reasons); list("uncertainty",rec.uncertainty);
  const logged = runs.some(run => run.session_id === session.id);
  $("open-log").hidden = logged;
  $("open-log").textContent = rec.session_type === "rest" ? "Ran anyway? Log what happened" : "Log a completed run";
  status("result-status",logged ? "Your completed run is saved." : rec.session_type === "rest" ? "No run log is needed for a recovery day." : "Suggestion saved. Come back after your run to log how it went.");
  if (focus) $("recommendation-title").focus();
}
function populate(checkin) {
  for (const key of ["sleep_hours","sleep_quality","energy","fatigue","soreness","soreness_area","available_minutes"]) {
    if (checkin[key] !== undefined && checkin[key] !== null) form.elements[key].value = checkin[key];
  }
  setSorenessArea();
}
$("daily-back").addEventListener("click",() => { if (!busy) showStep(step-1); });
form.querySelectorAll('input[name="soreness"]').forEach(input => input.addEventListener("change",setSorenessArea));
form.addEventListener("submit",async event => {
  event.preventDefault();
  if (busy) return;
  const invalid = Array.from(panels[step].querySelectorAll("input")).find(input => !input.checkValidity());
  if (invalid) {invalid.reportValidity();return;}
  if (step < 4) {showStep(step+1);return;}
  const data = {...Object.fromEntries(new FormData(form)),date:localDate()};
  busy = true; $("daily-fields").disabled = true; status("checkin-status","Considering your check-in…");
  try {
    const session = await api("/api/daily-checkins",data);
    showResult(session);
  } catch (error) {status("checkin-status",error.message,true);}
  finally {busy = false;$("daily-fields").disabled = false;}
});
$("edit-checkin").addEventListener("click",() => {
  $("daily-result").hidden = true;$("log-card").hidden = true;$("daily-flow").hidden = false;showStep(0);
});
$("open-log").addEventListener("click",() => {
  $("log-form").reset(); $("session-id").value = activeSession.id; $("log-card").hidden = false;
  $("log-form").querySelector("button").hidden = false;
  status("log-status",""); $("log-title").focus();
});
$("log-form").addEventListener("submit",async event => {
  event.preventDefault();
  const button = event.target.querySelector("button");
  if (button.disabled) return;
  const data = Object.fromEntries(new FormData(event.target));
  button.disabled = true; status("log-status","Saving your run…");
  try {
    runs.unshift(await api("/api/runs",data));
    button.hidden = true; $("open-log").hidden = true;
    status("log-status","Run saved. It will inform your next check-in.");
    status("result-status","Your completed run is saved.");
  } catch (error) {status("log-status",error.message,true);}
  finally {button.disabled = false;}
});
async function initialize() {
  $("retry-load").hidden = true; status("daily-loading","Getting your check-in ready…");
  try {
    const {profile} = await api("/api/profile");
    if (!profile) {window.location.replace("/profile");return;}
    $("profile-summary").textContent = `${profile.goal === "race" ? "Race preparation" : "General running fitness"} · ${profile.weekly_distance_km} km/week`;
    const history = await api("/api/history");
    runs = history.runs;
    const saved = history.sessions.find(session => session.date === localDate() && session.checkin.source === "body_checkin");
    $("daily-loading").hidden = true;
    if (saved) {populate(saved.checkin);showResult(saved,false);}
    else {$("daily-flow").hidden = false;showStep(0,false);}
  } catch (error) {
    status("daily-loading",error.message,true); $("retry-load").hidden = false;
  }
}
$("retry-load").addEventListener("click",initialize);
initialize();
