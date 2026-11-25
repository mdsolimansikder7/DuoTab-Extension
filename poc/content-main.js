// Phase 2 PoC content script in the page's MAIN world.
// It shows what a document.cookie and localStorage override can and cannot do.

(function () {
  "use strict";

  const jar = new Map([["poc_seed", "seeded"]]);
  const PREFIX = "duotab-poc:";

  function cookieText() {
    return Array.from(jar.entries())
      .map(function (pair) { return pair[0] + "=" + pair[1]; })
      .join("; ");
  }

  function writeCookie(value) {
    const parts = String(value).split(";");
    const first = parts.shift() || "";
    const equals = first.indexOf("=");
    if (equals < 0) return;
    const name = first.slice(0, equals).trim();
    const cookieValue = first.slice(equals + 1).trim();
    if (!name) return;

    let expired = false;
    for (const part of parts) {
      const lower = part.trim().toLowerCase();
      if (lower.startsWith("max-age=") && Number(lower.slice(8)) <= 0) expired = true;
      if (lower.startsWith("expires=")) {
        const time = Date.parse(part.trim().slice(8));
        if (Number.isFinite(time) && time <= Date.now()) expired = true;
      }
    }

    if (expired) jar.delete(name);
    else jar.set(name, cookieValue);
  }

  let cookieOverride = false;
  try {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get: cookieText,
      set: writeCookie
    });
    cookieOverride = true;
  } catch (error) {
    cookieOverride = false;
  }

  let storageOverride = false;
  let rawStorageGet = null;
  try {
    const rawGet = Storage.prototype.getItem;
    const rawSet = Storage.prototype.setItem;
    const rawRemove = Storage.prototype.removeItem;
    rawStorageGet = rawGet;

    Storage.prototype.getItem = function (key) {
      return rawGet.call(this, PREFIX + key);
    };
    Storage.prototype.setItem = function (key, value) {
      return rawSet.call(this, PREFIX + key, value);
    };
    Storage.prototype.removeItem = function (key) {
      return rawRemove.call(this, PREFIX + key);
    };
    storageOverride = true;
  } catch (error) {
    storageOverride = false;
  }

  // The bridge can read the real (prefixed) keys for the report.
  window.__duotabPocRawGet = function (rawKey) {
    try {
      return rawStorageGet.call(localStorage, rawKey);
    } catch (error) {
      return null;
    }
  };

  window.addEventListener("DOMContentLoaded", function () {
    const report = {
      cookieOverride: cookieOverride,
      storageOverride: storageOverride,
      seededCookie: document.cookie,
      earlyCookie: window.__pocEarlyCookie || "",
      afterWriteCookie: window.__pocAfterCookie || "",
      pageLocalValue: window.__pocLocal || null,
      realStoredKey: PREFIX + "token",
      realStoredValue: null
    };

    try {
      report.realStoredValue = window.__duotabPocRawGet(PREFIX + "token");
    } catch (error) {
      report.realStoredValue = null;
    }

    window.postMessage({ source: "duotab-poc", report: report }, "*");
  });
})();
