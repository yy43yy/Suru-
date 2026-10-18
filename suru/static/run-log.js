"use strict";

// Shared request and save behaviour for completed-run forms on Today and History.
window.Suru = (() => {
  async function api(path, data) {
    const response = await fetch(path, data === undefined ? {} : {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
    return result;
  }

  function bindRunLog(form, {path = "/api/runs", message, data = values => values, onSaved}) {
    let saving = false;
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      const values = Object.fromEntries(new FormData(form));
      const controls = [...form.elements].map(control => [control, control.disabled]);
      controls.forEach(([control]) => { control.disabled = true; });
      message.classList.remove("error");
      message.textContent = "Saving…";
      try {
        const target = typeof path === "function" ? path(values) : path;
        const result = await api(target, data(values));
        await onSaved(result);
      } catch (error) {
        message.textContent = error.message || "Could not save this run. Please try again.";
        message.classList.add("error");
      } finally {
        controls.forEach(([control, disabled]) => { control.disabled = disabled; });
        saving = false;
      }
    });
  }

  function settingLabel(value) {
    return {outdoor:"Outdoor", treadmill:"Treadmill"}[value] || "Setting not recorded";
  }

  return {api, bindRunLog, settingLabel};
})();
