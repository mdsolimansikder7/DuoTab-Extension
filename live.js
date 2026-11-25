// DuoTab live session tabs.
// The background service worker owns the data; this file only renders and sends actions.
(function () {
  "use strict";

  const panelLive = document.getElementById("panel-live");
  const panelSaved = document.getElementById("panel-saved");
  const viewLiveTab = document.getElementById("view-live-tab");
  const viewSavedTab = document.getElementById("view-saved-tab");

  const thisTabPill = document.getElementById("this-tab-pill");
  const thisTabDot = document.getElementById("this-tab-dot");
  const thisTabLabel = document.getElementById("this-tab-label");

  const defaultUrlInput = document.getElementById("default-url");
  const newSessionButton = document.getElementById("new-session-button");
  const manyCountInput = document.getElementById("many-count");
  const manyButton = document.getElementById("many-button");
  const liveStatus = document.getElementById("live-status");
  const liveCount = document.getElementById("live-count");
  const liveEmpty = document.getElementById("live-empty");
  const liveList = document.getElementById("live-list");
  const reopenButton = document.getElementById("reopen-button");
  const closedCount = document.getElementById("closed-count");
  const closedList = document.getElementById("closed-list");
  const exportButton = document.getElementById("live-export-button");
  const importButton = document.getElementById("live-import-button");
  const importFileInput = document.getElementById("live-import-file");

  let state = { sessions: [], defaultUrl: "", currentSession: null };
  let currentTabId = null;
  let closedOpen = false;
  let busy = false;
  let statusTimer = null;
  let refreshTimer = null;

  // ---------- Helpers ----------

  function safeColor(value) {
    return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#6366f1";
  }

  function tabCountText(count) {
    return count + (count === 1 ? " tab" : " tabs");
  }

  function showStatus(message, type) {
    liveStatus.textContent = message;
    liveStatus.className = "status " + (type || "info");
    liveStatus.hidden = false;

    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(function () {
      liveStatus.hidden = true;
    }, type === "error" ? 6000 : 3500);
  }

  async function send(message) {
    let response;
    try {
      response = await chrome.runtime.sendMessage(message);
    } catch (error) {
      throw new Error("DuoTab is not ready. Close and reopen the popup.");
    }
    if (!response) throw new Error("DuoTab did not reply. Try again.");
    if (response.ok === false) throw new Error(response.error || "Something went wrong.");
    return response;
  }

  // Blank means about:blank. Text without a scheme gets https://.
  function normalizeInputUrl(value) {
    const text = value.trim().toLowerCase();
    if (!text) return "";
    if (text === "about:blank" || text === "about.blank") return "";
    let candidate = text;
    if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
    try {
      const url = new URL(candidate);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    } catch (error) {
      // Invalid URL.
    }
    return null;
  }

  async function withBusy(task) {
    if (busy) return;
    busy = true;
    newSessionButton.disabled = true;
    manyButton.disabled = true;
    try {
      await task();
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      busy = false;
      newSessionButton.disabled = false;
      manyButton.disabled = false;
    }
  }

  // ---------- Load and render ----------

  async function refresh() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      currentTabId = tabs[0] ? tabs[0].id : null;
      state = await send({ type: "get-state", tabId: currentTabId });
      render();
    } catch (error) {
      showStatus(error.message, "error");
    }
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      if (!panelLive.hidden) refresh();
    }, 120);
  }

  function render() {
    // Do not overwrite text while the user is typing.
    if (document.activeElement !== defaultUrlInput) {
      defaultUrlInput.value = state.defaultUrl || "";
    }

    const current = state.currentSession;
    thisTabDot.hidden = !current;
    thisTabPill.classList.toggle("is-session", Boolean(current));
    if (current) {
      thisTabDot.style.backgroundColor = safeColor(current.color);
      thisTabLabel.textContent = "This tab: " + current.name;
      thisTabPill.title = current.name + " \u00b7 " + tabCountText(current.openTabs);
    } else {
      thisTabLabel.textContent = "This tab: not in a session";
      thisTabPill.title = "";
    }

    const active = state.sessions
      .filter(function (session) { return session.openTabs > 0; })
      .sort(function (a, b) { return a.number - b.number; });

    const closed = state.sessions
      .filter(function (session) {
        return session.openTabs === 0 && session.closedTabCount > 0;
      })
      .sort(function (a, b) { return a.number - b.number; });

    liveCount.textContent = active.length + " open";
    liveEmpty.hidden = !(active.length === 0 && closed.length === 0);

    liveList.replaceChildren();
    for (const session of active) {
      liveList.appendChild(createSessionCard(session));
    }

    renderClosed(closed);
  }

  function createSessionCard(session) {
    const card = document.createElement("article");
    card.className = "live-card";
    card.dataset.sessionId = session.id;

    const badge = document.createElement("span");
    badge.className = "session-badge";
    badge.textContent = String(session.number);
    badge.style.backgroundColor = safeColor(session.color);

    const info = document.createElement("div");
    info.className = "live-info";
    const name = document.createElement("span");
    name.className = "session-name";
    name.textContent = session.name;
    const meta = document.createElement("span");
    meta.className = "session-meta";
    meta.textContent = tabCountText(session.openTabs);
    info.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "live-actions";

    const goButton = document.createElement("button");
    goButton.type = "button";
    goButton.className = "card-button primary";
    goButton.textContent = "Go";
    goButton.title = "Focus this session's tab";
    goButton.addEventListener("click", function () {
      runAction(function () {
        return send({ type: "focus-session", sessionId: session.id });
      }, "Focused " + session.name + ".");
    });

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "card-button";
    addButton.textContent = "+";
    addButton.title = "Open another tab in this session";
    addButton.setAttribute("aria-label", "Open another tab in " + session.name);
    addButton.addEventListener("click", function () {
      runAction(function () {
        return send({ type: "add-tab", sessionId: session.id });
      }, "Opened another tab in " + session.name + ".");
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "card-button danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", function () {
      const shouldDelete = window.confirm(
        'Delete "' + session.name + '" and close its tabs?'
      );
      if (!shouldDelete) return;
      runAction(function () {
        return send({ type: "delete-session", sessionId: session.id });
      }, session.name + " deleted.");
    });

    actions.append(goButton, addButton, deleteButton);
    card.append(badge, info, actions);
    return card;
  }

  function renderClosed(closed) {
    closedCount.textContent = closed.length ? "(" + closed.length + ")" : "";
    reopenButton.disabled = closed.length === 0;
    reopenButton.setAttribute("aria-expanded", String(closedOpen));

    if (closed.length === 0) closedOpen = false;
    closedList.hidden = !closedOpen || closed.length === 0;
    closedList.replaceChildren();

    if (!closedOpen) return;

    for (const session of closed) {
      const row = document.createElement("div");
      row.className = "closed-row";

      const badge = document.createElement("span");
      badge.className = "session-badge small";
      badge.textContent = String(session.number);
      badge.style.backgroundColor = safeColor(session.color);

      const info = document.createElement("div");
      info.className = "live-info";
      const name = document.createElement("span");
      name.className = "closed-name";
      name.textContent = session.name;
      const meta = document.createElement("span");
      meta.className = "session-meta";
      meta.textContent = session.closedTabCount +
        (session.closedTabCount === 1 ? " saved tab" : " saved tabs");
      info.append(name, meta);

      const reopen = document.createElement("button");
      reopen.type = "button";
      reopen.className = "card-button primary";
      reopen.textContent = "Reopen";
      reopen.addEventListener("click", function () {
        runAction(function () {
          return send({ type: "reopen-session", sessionId: session.id });
        }, "Reopened " + session.name + ".");
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "card-button danger";
      remove.textContent = "Delete";
      remove.addEventListener("click", function () {
        const shouldDelete = window.confirm('Delete "' + session.name + '"?');
        if (!shouldDelete) return;
        runAction(function () {
          return send({ type: "delete-session", sessionId: session.id });
        }, session.name + " deleted.");
      });

      row.append(badge, info, reopen, remove);
      closedList.appendChild(row);
    }
  }

  async function runAction(task, successMessage) {
    if (busy) return;
    busy = true;
    try {
      await task();
      if (successMessage) showStatus(successMessage, "success");
      await refresh();
    } catch (error) {
      showStatus(error.message, "error");
    } finally {
      busy = false;
    }
  }

  // ---------- Actions ----------

  function createNewSession() {
    const url = normalizeInputUrl(defaultUrlInput.value);
    if (url === null) {
      showStatus("Enter a valid http or https URL, or leave it blank for about:blank.", "error");
      return;
    }

    withBusy(async function () {
      const result = await send({ type: "create-session", defaultUrl: url });
      const created = result.created && result.created[0];
      showStatus(created ? created.name + " created." : "Session created.", "success");
      await refresh();
    });
  }

  function createManySessions() {
    const count = Number(manyCountInput.value);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      showStatus("Choose between 1 and 100 sessions per click.", "error");
      return;
    }

    const url = normalizeInputUrl(defaultUrlInput.value);
    if (url === null) {
      showStatus("Enter a valid http or https URL, or leave it blank for about:blank.", "error");
      return;
    }

    withBusy(async function () {
      const result = await send({ type: "create-many", count: count, defaultUrl: url });
      const createdCount = result.created ? result.created.length : 0;
      showStatus("Created " + createdCount + (createdCount === 1 ? " session." : " sessions."), "success");
      await refresh();
    });
  }

  function exportSessions() {
    try {
      const data = {
        app: "DuoTab",
        format: "live-sessions",
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: state.sessions.map(function (session) {
          return {
            number: session.number,
            name: session.name,
            color: session.color,
            createdAt: session.createdAt,
            tabs: session.tabs,
            closedTabs: session.closedTabs
          };
        })
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = "duotab-live-sessions-" + new Date().toISOString().slice(0, 10) + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 1000);
      showStatus("Sessions exported.", "success");
    } catch (error) {
      showStatus("Could not export your sessions.", "error");
    }
  }

  async function importSessionsFromFile(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const rawSessions = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.sessions) ? parsed.sessions : null;

      if (!rawSessions) {
        showStatus("That file does not look like a DuoTab export.", "error");
        return;
      }

      const result = await send({ type: "import-sessions", sessions: rawSessions });
      let message = "Imported " + result.imported +
        (result.imported === 1 ? " session." : " sessions.");
      if (result.skipped > 0) {
        message += " Skipped " + result.skipped +
          (result.skipped === 1 ? " invalid session." : " invalid sessions.");
      }
      showStatus(message, "success");
      await refresh();
    } catch (error) {
      showStatus("Could not import that file. Choose a DuoTab JSON export.", "error");
    }
  }

  // ---------- View switching ----------

  function showView(view) {
    const live = view === "live";
    panelLive.hidden = !live;
    panelSaved.hidden = live;
    viewLiveTab.classList.toggle("is-active", live);
    viewSavedTab.classList.toggle("is-active", !live);
    viewLiveTab.setAttribute("aria-selected", String(live));
    viewSavedTab.setAttribute("aria-selected", String(!live));
    if (live) refresh();
  }

  // ---------- Events ----------

  viewLiveTab.addEventListener("click", function () { showView("live"); });
  viewSavedTab.addEventListener("click", function () { showView("saved"); });
  newSessionButton.addEventListener("click", createNewSession);
  manyButton.addEventListener("click", createManySessions);

  defaultUrlInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") createNewSession();
  });

  manyCountInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") createManySessions();
  });

  reopenButton.addEventListener("click", function () {
    closedOpen = !closedOpen;
    render();
  });

  exportButton.addEventListener("click", exportSessions);
  importButton.addEventListener("click", function () { importFileInput.click(); });
  importFileInput.addEventListener("change", async function () {
    const file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (file) await importSessionsFromFile(file);
  });

  window.addEventListener("focus", function () {
    if (!panelLive.hidden) refresh();
  });

  chrome.storage.onChanged.addListener(function (changes, areaName) {
    if (areaName === "local" && (changes.liveSessions || changes.liveDefaultUrl)) {
      scheduleRefresh();
    }
    if (areaName === "session" && changes.liveTabMap) {
      scheduleRefresh();
    }
  });

  refresh();
})();
