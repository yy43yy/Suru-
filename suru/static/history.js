async function loadHistory() {
    const status = document.getElementById("history-status");
    const output = document.getElementById("history-data");
  
    try {
      const response = await fetch("/api/history");
  
      if (!response.ok) {
        throw new Error("Could not load history.");
      }
  
      const history = await response.json();
  
      output.textContent = JSON.stringify(history, null, 2);
      status.textContent = "History loaded.";
    } catch (error) {
      status.textContent = error.message;
    }
  }
  
  loadHistory();