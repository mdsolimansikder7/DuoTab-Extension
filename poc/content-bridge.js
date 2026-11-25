// Phase 2 PoC bridge: forwards MAIN-world results to the service worker.
(function () {
  "use strict";

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "duotab-poc" || !data.report) return;

    chrome.runtime.sendMessage({
      type: "poc-page-report",
      report: data.report
    }).catch(function () {
      // The worker may be asleep; this is only a test helper.
    });
  });
})();
