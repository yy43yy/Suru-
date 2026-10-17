"use strict";
const {api, bindRunLog} = window.Suru;

const labels = {easy:"Easy run", long:"Long run", tempo:"Tempo run", intervals:"Intervals", rest:"Rest recommended"};
const choices = {recommendation:"Followed Suru’s suggestion", original:"Followed original plan", other:"Chose another session"};
const journal = document.getElementById("journal");
const output = document.getElementById("history-list");
const status = document.getElementById("history-status");
const retry = document.getElementById("history-retry");
let currentHistory = {sessions:[], runs:[], activities:[]};

function el(tag, text = "", className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

// Parse calendar dates locally so a date never shifts with the user's time zone.
function calendarDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function sessionLabel(type, minutes) {
  return type === "rest" ? labels.rest : `${labels[type] || type} · ${minutes} min`;
}

function facts(title, items) {
  const section = el("section", "", "journal-detail-section");
  section.append(el("h4", title));
  const list = el("dl", "", "journal-facts");
  for (const [label, value] of items) {
    const pair = el("div");
    pair.append(el("dt", label), el("dd", value));
    list.append(pair);
  }
  section.append(list);
  return section;
}

function bulletSection(title, items) {
  const section = el("section", "", "journal-detail-section");
  const list = el("ul");
  list.append(...items.map(item => el("li", item)));
  section.append(el("h4", title), list);
  return section;
}

function logForm(session, card) {
  const form = el("form", "", "journal-log");
  form.setAttribute("aria-label", `Log run for ${session.date}, check-in ${session.id}`);
  form.append(el("h4", "How did the run go?"));
  const fields = el("div", "", "fields");
  function field(label, name, attributes) {
    const wrapper = el("label", label);
    const input = el("input");
    input.name = name;
    for (const [key, value] of Object.entries(attributes)) input.setAttribute(key, value);
    wrapper.append(input);
    fields.append(wrapper);
  }
  const choiceLabel = el("label", "What did you follow?");
  const select = el("select");
  select.name = "choice";
  for (const [value, text] of Object.entries({recommendation:"Suru’s suggestion", original:"My original session", other:"Another session"})) {
    const option = el("option", text);
    option.value = value;
    select.append(option);
  }
  choiceLabel.append(select);
  fields.append(choiceLabel);
  field("Actual duration · minutes", "minutes", {type:"number", min:"1", max:"600", step:"0.1", required:""});
  field("Distance · km", "distance_km", {type:"number", min:"0.01", max:"300", step:"0.01", required:""});
  field("Perceived effort · 1–10", "effort", {type:"number", min:"1", max:"10", step:"1", required:""});
  const notesLabel = el("label", "Run notes", "wide");
  const notes = el("textarea");
  notes.name = "notes";
  notes.maxLength = 500;
  notes.rows = 2;
  notesLabel.append(notes);
  const button = el("button", "Save completed run", "primary");
  button.type = "submit";
  const message = el("p", "", "status");
  message.setAttribute("role", "status");
  form.append(fields, notesLabel, el("p", "1 = very easy · 10 = maximal effort. The run is saved against this check-in’s date.", "hint"), button, message);
  bindRunLog(form, {
    message,
    data: values => ({...values, session_id:session.id}),
    onSaved(result) {
      currentHistory.runs = [result, ...currentHistory.runs.filter(run => run.session_id !== session.id)];
      const updated = sessionCard(session, result);
      updated.open = true;
      card.replaceWith(updated);
      const saved = el("p", "Run saved. Your next check-in will consider this session.", "status journal-saved");
      saved.setAttribute("role", "status");
      saved.tabIndex = -1;
      updated.querySelector(".journal-detail").append(saved);
      saved.focus({preventScroll:true});
    }
  });
  return form;
}

function sessionCard(session, run) {
  const rec = session.recommendation;
  const checkin = session.checkin;
  const rest = rec.action === "rest" || rec.session_type === "rest";
  const card = el("details", "", "journal-card");
  card.dataset.sessionId = session.id;
  const summary = el("summary", "", "journal-summary");
  const heading = el("div", "", "journal-card-heading");
  const state = run ? "Completed" : rest ? "Rest recommended" : "Awaiting run log";
  heading.append(el("span", sessionLabel(rec.session_type, rec.minutes), "journal-run-title"), el("span", state, `journal-status ${run ? "is-complete" : rest ? "is-rest" : "is-pending"}`));
  const description = run
    ? `${run.distance_km} km in ${run.minutes} min · Effort ${run.effort}/10`
    : rest ? "A recovery day was suggested. No run log needed."
    : rec.action === "adjust" ? "Suru adjusted your original plan." : "Your original plan fits this check-in.";
  summary.append(heading, el("span", description, "journal-description"), el("span", "Planned: " + sessionLabel(checkin.session_type, checkin.planned_minutes), "journal-planned"));
  const toggle = el("span", "", "journal-toggle");
  toggle.append(el("span", run || rest ? "View details" : "View details / Log run", "when-closed"), el("span", "Close details", "when-open"), el("span", "⌄", "journal-chevron"));
  summary.append(toggle);
  const detail = el("div", "", "journal-detail");
  detail.append(facts("Plan & suggestion", [
    ["Original plan", sessionLabel(checkin.session_type, checkin.planned_minutes)],
    ["Time available", `${checkin.available_minutes} min`],
    ["Suru suggested", sessionLabel(rec.session_type, rec.minutes)],
    ["Intensity", rec.intensity]
  ]));
  detail.append(bulletSection("Why this suggestion", rec.reasons));
  const context = el("details", "", "journal-context");
  context.append(el("summary", "Check-in & recovery details"));
  context.append(facts("Your check-in", [
    ["Goal", checkin.goal === "race" ? "Race preparation" : "General running fitness"],
    ["Sleep", checkin.sleep_hours == null ? "Not recorded" : `${checkin.sleep_hours} hours`],
    ["Energy", checkin.energy], ["Fatigue", checkin.fatigue], ["Leg soreness", checkin.soreness],
    ["Recent load", {unknown:"Not sure", usual:"About usual", higher:"Higher than usual"}[checkin.recent_load]],
    ["HRV", checkin.hrv == null ? "Not recorded" : `${checkin.hrv} ms`]
  ]));
  if (checkin.notes) context.append(el("p", `Check-in notes: ${checkin.notes}`, "journal-notes"));
  context.append(facts("Recovery context", Object.entries(rec.states)));
  context.append(bulletSection("What this suggestion can’t tell us", rec.uncertainty));
  if (run) {
    detail.append(facts("Actual run", [
      ["Duration", `${run.minutes} min`], ["Distance", `${run.distance_km} km`],
      ["Effort", `${run.effort}/10`], ["Your choice", choices[run.choice]]
    ]));
    if (run.notes) detail.append(el("p", `Run notes: ${run.notes}`, "journal-notes"));
  } else if (!rest) {
    detail.append(logForm(session, card));
  }
  detail.append(context);
  card.append(summary, detail);
  return card;
}

function renderHistory(history) {
  output.replaceChildren();
  if (!history.sessions.length && !history.activities?.length) {
    const empty = el("div", "", "history-empty");
    empty.append(el("h2", "Your journal starts here"), el("p", "Log a past run above, or make your first check-in to save a plan and suggestion."));
    const link = el("a", "Make your first check-in ↗", "secondary");
    link.href = "/";
    empty.append(link);
    output.append(empty);
    return;
  }
  const runs = new Map(history.runs.map(run => [run.session_id, run]));
  const entries = [
    ...history.sessions.map(session => ({...session, source:"checkin"})),
    ...(history.activities || []).map(activity => ({...activity, source:"activity"}))
  ].sort((a, b) => b.date.localeCompare(a.date) || (b.created_at || "").localeCompare(a.created_at || "") || b.id - a.id || a.source.localeCompare(b.source));
  let monthKey, dayKey, month, dayCards;
  for (const session of entries) {
    const date = calendarDate(session.date);
    if (session.date.slice(0, 7) !== monthKey) {
      monthKey = session.date.slice(0, 7);
      month = el("section", "", "journal-month");
      const title = el("h2", date.toLocaleDateString("en-GB", {month:"long", year:"numeric"}), "journal-month-title");
      title.id = `month-${monthKey}`;
      month.setAttribute("aria-labelledby", title.id);
      month.append(title);
      output.append(month);
    }
    if (session.date !== dayKey) {
      dayKey = session.date;
      const day = el("section", "", "journal-day");
      const heading = el("h3", "", "journal-date");
      const time = el("time", date.toLocaleDateString("en-GB", {weekday:"long", day:"numeric", month:"long"}));
      time.dateTime = session.date;
      heading.id = `day-${session.date}`;
      heading.append(time);
      day.setAttribute("aria-labelledby", heading.id);
      dayCards = el("div", "", "journal-day-cards");
      day.append(heading, dayCards);
      month.append(day);
    }
    dayCards.append(session.source === "activity" ? activityCard(session) : sessionCard(session, runs.get(session.id)));
  }
}

async function loadHistory() {
  document.getElementById("add-activity").disabled = true;
  journal.setAttribute("aria-busy", "true");
  retry.hidden = true;
  status.classList.remove("error");
  status.textContent = "Loading your journal…";
  try {
    const history = await api("/api/history");
    currentHistory = history;
    renderHistory(history);
    status.textContent = history.sessions.length || history.activities?.length ? "Showing up to 100 recent check-ins and 100 added runs." : "";
  } catch (error) {
    status.textContent = "Could not load your journal. Check your connection and try again.";
    status.classList.add("error");
    retry.hidden = false;
  } finally {
    journal.setAttribute("aria-busy", "false");
    document.getElementById("add-activity").disabled = false;
  }
}

retry.addEventListener("click", loadHistory);
loadHistory();

function activityCard(activity) {
  const card = el("details", "", "journal-card");
  card.dataset.activityId = activity.id;
  const summary = el("summary", "", "journal-summary");
  const heading = el("div", "", "journal-card-heading");
  heading.append(el("span", sessionLabel(activity.session_type, activity.minutes), "journal-run-title"), el("span", "Completed", "journal-status is-complete"));
  summary.append(heading,
    el("span", `${activity.distance_km} km in ${activity.minutes} min · Effort ${activity.effort}/10`, "journal-description"),
    el("span", "Added run · No check-in or suggestion", "journal-planned"));
  const toggle = el("span", "", "journal-toggle");
  toggle.append(el("span", "View details", "when-closed"), el("span", "Close details", "when-open"), el("span", "⌄", "journal-chevron"));
  summary.append(toggle);
  const detail = el("div", "", "journal-detail");
  detail.append(facts("Actual run", [
    ["Run type", labels[activity.session_type]], ["Duration", `${activity.minutes} min`],
    ["Distance", `${activity.distance_km} km`], ["Effort", `${activity.effort}/10`]
  ]));
  if (activity.notes) detail.append(el("p", `Run notes: ${activity.notes}`, "journal-notes"));
  card.append(summary, detail);
  return card;
}

const addActivity = document.getElementById("add-activity");
const activityPanel = document.getElementById("past-activity-panel");
const activityForm = document.getElementById("past-activity-form");
const activityStatus = document.getElementById("past-activity-status");
const activityDate = document.getElementById("past-activity-date");
const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
activityDate.max = localToday;
activityDate.value = localToday;

function showActivityForm(show) {
  activityPanel.hidden = !show;
  addActivity.setAttribute("aria-expanded", String(show));
  if (show) {
    document.getElementById("past-activity-title").focus();
  } else {
    addActivity.focus({preventScroll:true});
  }
}
addActivity.addEventListener("click", () => showActivityForm(activityPanel.hidden));
document.getElementById("cancel-activity").addEventListener("click", () => showActivityForm(false));
bindRunLog(activityForm, {
  path: "/api/activities",
  message: activityStatus,
  onSaved(result) {
    currentHistory.activities = [result, ...(currentHistory.activities || [])];
    renderHistory(currentHistory);
    activityForm.reset();
    activityDate.value = localToday;
    activityStatus.textContent = "";
    showActivityForm(false);
    status.textContent = `Run saved for ${calendarDate(result.date).toLocaleDateString("en-GB", {day:"numeric",month:"long",year:"numeric"})}.`;
    const card = output.querySelector(`[data-activity-id="${result.id}"]`);
    card.querySelector("summary").focus({preventScroll:true});
    card.scrollIntoView({behavior:"smooth",block:"center"});
  }
});
