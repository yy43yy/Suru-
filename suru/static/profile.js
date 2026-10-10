"use strict";
const form = document.getElementById("profile-form");
const fields = document.getElementById("profile-fields");
const message = document.getElementById("profile-status");
const retry = document.getElementById("profile-retry");
const longDay = document.getElementById("long-run-day");
const dayNames = {mon:"Monday",tue:"Tuesday",wed:"Wednesday",thu:"Thursday",fri:"Friday",sat:"Saturday",sun:"Sunday"};

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
  const options = [new Option("No preference", ""), ...selectedDays().map(day => new Option(dayNames[day], day))];
  longDay.replaceChildren(...options);
  longDay.value = selectedDays().includes(preferred) ? preferred : "";
}
form.querySelectorAll('input[name="running_days"]').forEach(input => input.addEventListener("change", () => updateLongDays()));
retry.addEventListener("click", load);

async function load() {
  fields.disabled = true;
  retry.hidden = true;
  status("Loading…");
  try {
    const {profile} = await api();
    if (profile) {
      form.elements.goal.value = profile.goal;
      form.elements.weekly_distance_km.value = profile.weekly_distance_km;
      form.querySelectorAll('input[name="running_days"]').forEach(input => { input.checked = profile.running_days.includes(input.value); });
      updateLongDays(profile.long_run_day || "");
      document.getElementById("profile-title").textContent = "Edit your running profile";
      document.getElementById("back-to-today").hidden = false;
    } else {
      updateLongDays();
    }
    fields.disabled = false;
    status("");
  } catch (error) {
    status(`Could not load your profile: ${error.message}`, true);
    retry.hidden = false;
  }
}
form.addEventListener("submit", async event => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  data.running_days = selectedDays();
  if (!data.running_days.length) {
    status("Choose at least one available running day.", true);
    form.querySelector('input[name="running_days"]').focus();
    return;
  }
  fields.disabled = true;
  status("Saving your profile…");
  try {
    await api(data);
    window.location.assign("/");
  } catch (error) {
    status(error.message, true);
    fields.disabled = false;
  }
});
load();
