// Phase 2 PoC page.
(function () {
  "use strict";

  const output = document.getElementById("output");
  const status = document.getElementById("status");

  function show(value) {
    output.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  async function run(action) {
    status.textContent = "Running " + action + "...";
    try {
      const response = await chrome.runtime.sendMessage({ type: action });
      if (!response || response.ok === false) {
        throw new Error(response && response.error ? response.error : "No response.");
      }
      show(response.result);
      status.textContent = "Finished " + action + ".";
    } catch (error) {
      status.textContent = "Error: " + error.message;
    }
  }

  document.getElementById("run-all").addEventListener("click", function () {
    run("run-all");
  });

  for (const button of document.querySelectorAll("[data-action]")) {
    button.addEventListener("click", function () {
      run(button.dataset.action);
    });
  }

  chrome.runtime.sendMessage({ type: "get-results" }).then(function (response) {
    if (response && response.ok && response.result) {
      show(response.result);
      status.textContent = "Loaded the last run.";
    } else {
      show("No results yet. Click Run all tests.");
    }
  }).catch(function () {
    show("No results yet. Click Run all tests.");
  });
})();
