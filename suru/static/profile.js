"use strict";
const form = document.getElementById("profile-form");
const fields = document.getElementById("profile-fields");
const message = document.getElementById("profile-status");
const retry = document.getElementById("profile-retry");
const longDay = document.getElementById("long-run-day");
const panels = Array.from(form.querySelectorAll(".question-panel"));
const next = document.getElementById("next-question");
const back = document.getElementById("previous-question");
const save = document.getElementById("save-profile");
const dayNames = {mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday",sun:"Sunday"};
let currentStep = 0;
let ready = false;
let saving = false;

function status(text, error = false) {
  message.textContent = text;
  message.classList.toggle("error", error);
}
async function api(data) {
  const response = await fetch("/api/profile", data === undefined ? {} : {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to save your profile. Please try again.");
  return result;
}
function selectedDays() {
  return Array.from(form.querySelectorAll('input[name="running_days"]:checked'), input => input.value);
}
function updateLongDays(preferred = longDay.value) {
  const days = selectedDays();
  longDay.replaceChildren(new Option("No preference", ""), ...days.map(day => new Option(dayNames[day], day)));
  longDay.value = days.includes(preferred) ? preferred : "";
}
function review() {
  const answers = [
    ["Goal", form.elements.goal.value === "race" ? "Race preparation" : "General running fitness"],
    ["Weekly distance", `${form.elements.weekly_distance_km.value} km`],
    ["Available days", selectedDays().map(day => dayNames[day]).join(", ")],
    ["Long-run day", dayNames[longDay.value] || "No preference"]
  ];
  document.getElementById("profile-review").replaceChildren(...answers.map(([label, value], index) => {
    const row = document.createElement("div");
    const term = document.createElement("dt"); term.textContent = label;
    const description = document.createElement("dd"); description.textContent = value;
    const edit = document.createElement("button"); edit.type = "button"; edit.textContent = "Edit";
    edit.setAttribute("aria-label", `Edit ${label.toLowerCase()}`);
    edit.addEventListener("click", () => showStep(index));
    row.append(term, description, edit);
    return row;
  }));
}
function showStep(index, focus = true) {
  currentStep = index;
  panels.forEach((panel, i) => { panel.hidden = i !== index; });
  back.hidden = index === 0;
  next.hidden = index === 4;
  save.hidden = index !== 4;
  document.getElementById("step-label").textContent = index === 4 ? "Review your profile" : `Question ${index + 1} of 4`;
  document.getElementById("setup-progress").value = index + 1;
  if (index === 4) review();
  status("");
  if (focus) panels[index].querySelector("h1").focus();
}
function validateStep(index) {
  if (index === 2 && !selectedDays().length) {
    status("Choose at least one available running day.", true);
    form.querySelector('input[name="running_days"]').focus();
    return false;
  }
  const invalid = Array.from(panels[index].querySelectorAll("input, select")).find(input => !input.checkValidity());
  if (invalid) {
    invalid.reportValidity();
    return false;
  }
  return true;
}
back.addEventListener("click", () => showStep(currentStep - 1));
form.querySelectorAll('input[name="running_days"]').forEach(input => input.addEventListener("change", () => updateLongDays()));
retry.addEventListener("click", load);

async function load() {
  ready = false;
  fields.disabled = true;
  retry.hidden = true;
  status("Loading your profile…");
  try {
    const {profile} = await api();
    if (profile) {
      form.elements.goal.value = profile.goal;
      form.elements.weekly_distance_km.value = profile.weekly_distance_km;
      form.querySelectorAll('input[name="running_days"]').forEach(input => { input.checked = profile.running_days.includes(input.value); });
      updateLongDays(profile.long_run_day || "");
      document.getElementById("setup-label").textContent = "UPDATE YOUR RUNNING PROFILE";
      document.getElementById("back-to-today").hidden = false;
    } else {
      updateLongDays();
    }
    fields.disabled = false;
    ready = true;
    showStep(0, false);
  } catch (error) {
    status(`Could not load your profile: ${error.message}`, true);
    retry.hidden = false;
  }
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!ready || saving) return;
  if (currentStep < 4) {
    if (validateStep(currentStep)) showStep(currentStep + 1);
    return;
  }
  for (let i = 0; i < 4; i++) {
    panels[i].hidden = false;
    if (!validateStep(i)) {
      const error = message.textContent;
      showStep(i, false);
      if (error) status(error, true);
      return;
    }
    panels[i].hidden = true;
  }
  const data = Object.fromEntries(new FormData(form));
  data.running_days = selectedDays();
  saving = true;
  fields.disabled = true;
  status("Saving your profile…");
  try {
    await api(data);
    window.location.assign("/");
  } catch (error) {
    status(error.message, true);
    fields.disabled = false;
    saving = false;
  }
});
load();
