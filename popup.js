// DuoTab popup logic.
// All data is stored locally with chrome.storage.local.

const SESSIONS_KEY = "sessions";
const THEME_KEY = "duotab-theme";
const DEFAULT_FAVICON = "icons/icon16.png";

// In-memory state for the currently open popup.
let sessions = [];
let searchTerm = "";
let currentTheme = "light";
let statusTimer = null;
let isSaving = false;
const expandedIds = new Set();

// Element references.
const sessionNameInput = document.getElementById("session-name");
const saveButton = document.getElementById("save-button");
const searchInput = document.getElementById("search-input");
const sessionCount = document.getElementById("session-count");
const statusMessage = document.getElementById("status-message");
const emptyState = document.getElementById("empty-state");
const emptyTitle = document.getElementById("empty-title");
const emptyText = document.getElementById("empty-text");
const sessionList = document.getElementById("session-list");
const themeToggle = document.getElementById("theme-toggle");
const exportButton = document.getElementById("export-button");
const importButton = document.getElementById("import-button");
const importFileInput = document.getElementById("import-file");

const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");

// ---------- Small helpers ----------

function createId() {
  // Timestamp plus a few random characters keeps IDs unique in normal use.
  return "s" + Date.now() + Math.random().toString(36).slice(2, 6);
}

function isWebUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function safeFavicon(value) {
  // Only keep favicon values that are safe for an image tag.
  if (typeof value !== "string") {
    return "";
  }
  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:image/")
  ) {
    return value;
  }
  return "";
}

function formatDate(timestamp) {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return "Unknown date";
  }
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });
  } catch (error) {
    return new Date(timestamp).toLocaleString();
  }
}

function getDefaultSessionName() {
  return "Session " + formatDate(Date.now());
}

function tabCountText(count) {
  return count + (count === 1 ? " tab" : " tabs");
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = "status " + (type || "info");
  statusMessage.hidden = false;

  if (statusTimer) {
    clearTimeout(statusTimer);
  }

  // Errors stay a little longer so they are easy to read.
  const delay = type === "error" ? 6000 : 3500;
  statusTimer = setTimeout(function () {
    statusMessage.hidden = true;
  }, delay);
}

// ---------- Storage ----------

async function loadSessions() {
  try {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    const storedSessions = result[SESSIONS_KEY];

    if (!Array.isArray(storedSessions)) {
      return [];
    }

    return storedSessions.filter(function (session) {
      return (
        session &&
        typeof session === "object" &&
        typeof session.id === "string" &&
        typeof session.name === "string" &&
        Array.isArray(session.tabs)
      );
    });
  } catch (error) {
    console.error("DuoTab: could not load sessions.", error);
    showStatus("Could not load your saved sessions.", "error");
    return [];
  }
}

async function persistSessions() {
  try {
    await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
    return true;
  } catch (error) {
    console.error("DuoTab: could not save sessions.", error);
    showStatus("Could not save changes. Please try again.", "error");
    return false;
  }
}

// ---------- Main actions ----------

async function saveCurrentWindow() {
  if (isSaving) {
    return;
  }

  isSaving = true;
  saveButton.disabled = true;

  const enteredName = sessionNameInput.value.trim();
  const sessionName = enteredName || getDefaultSessionName();

  try {
    const windowTabs = await chrome.tabs.query({ currentWindow: true });

    // Keep only real web pages, in their visible tab order.
    const savedTabs = windowTabs
      .filter(function (tab) {
        return isWebUrl(tab.url);
      })
      .sort(function (a, b) {
        return a.index - b.index;
      })
      .map(function (tab) {
        return {
          title: tab.title || tab.url,
          url: tab.url,
          favicon: safeFavicon(tab.favIconUrl)
        };
      });

    if (savedTabs.length === 0) {
      showStatus("This window has no http or https tabs to save.", "error");
      return;
    }

    const newSession = {
      id: createId(),
      name: sessionName,
      createdAt: Date.now(),
      tabs: savedTabs
    };

    sessions.push(newSession);

    const saved = await persistSessions();
    if (!saved) {
      sessions.pop();
      return;
    }

    sessionNameInput.value = "";
    searchTerm = "";
    searchInput.value = "";
    renderSessions();
    showStatus("Saved " + tabCountText(savedTabs.length) + ' as "' + sessionName + '".', "success");
  } catch (error) {
    console.error("DuoTab: could not save this window.", error);
    showStatus("Could not read the tabs in this window.", "error");
  } finally {
    isSaving = false;
    saveButton.disabled = false;
  }
}

async function openSession(session) {
  const urls = session.tabs
    .map(function (tab) {
      return tab.url;
    })
    .filter(isWebUrl);

  if (urls.length === 0) {
    showStatus("This session has no valid tabs to open.", "error");
    return;
  }

  try {
    await chrome.windows.create({ url: urls, focused: true });
    showStatus('Opened "' + session.name + '".', "success");
  } catch (error) {
    console.error("DuoTab: could not open session.", error);
    showStatus("Could not open this session.", "error");
  }
}

async function openTabUrl(url) {
  if (!isWebUrl(url)) {
    showStatus("This tab does not have a valid web address.", "error");
    return;
  }

  try {
    await chrome.tabs.create({ url: url });
  } catch (error) {
    console.error("DuoTab: could not open tab.", error);
    showStatus("Could not open this tab.", "error");
  }
}

async function renameSession(session) {
  const newName = window.prompt("Rename session:", session.name);

  if (newName === null) {
    return;
  }

  const trimmedName = newName.trim();
  if (!trimmedName) {
    showStatus("Session name cannot be empty.", "error");
    return;
  }

  const oldName = session.name;
  session.name = trimmedName;

  const saved = await persistSessions();
  if (!saved) {
    session.name = oldName;
    return;
  }

  renderSessions();
  showStatus("Session renamed.", "success");
}

async function deleteSession(session) {
  const shouldDelete = window.confirm('Delete "' + session.name + '"? This cannot be undone.');

  if (!shouldDelete) {
    return;
  }

  const oldSessions = sessions;
  sessions = sessions.filter(function (item) {
    return item.id !== session.id;
  });

  const saved = await persistSessions();
  if (!saved) {
    sessions = oldSessions;
    return;
  }

  expandedIds.delete(session.id);
  renderSessions();
  showStatus("Session deleted.", "success");
}

async function removeTabFromSession(sessionId, tabToRemove) {
  const session = sessions.find(function (item) {
    return item.id === sessionId;
  });

  if (!session) {
    return;
  }

  const oldTabs = session.tabs;
  session.tabs = session.tabs.filter(function (tab) {
    return tab !== tabToRemove;
  });

  const saved = await persistSessions();
  if (!saved) {
    session.tabs = oldTabs;
    return;
  }

  renderSessions();
  showStatus("Tab removed.", "success");
}

async function addCurrentTabToSession(sessionId) {
  const session = sessions.find(function (item) {
    return item.id === sessionId;
  });

  if (!session) {
    return;
  }

  try {
    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const currentTab = activeTabs[0];

    if (!currentTab || !isWebUrl(currentTab.url)) {
      showStatus("Only http and https tabs can be added.", "error");
      return;
    }

    session.tabs.push({
      title: currentTab.title || currentTab.url,
      url: currentTab.url,
      favicon: safeFavicon(currentTab.favIconUrl)
    });

    const saved = await persistSessions();
    if (!saved) {
      session.tabs.pop();
      return;
    }

    expandedIds.add(sessionId);
    renderSessions();
    showStatus("Current tab added.", "success");
  } catch (error) {
    console.error("DuoTab: could not add the current tab.", error);
    showStatus("Could not add the current tab.", "error");
  }
}

// ---------- Export and import ----------

function exportSessions() {
  if (sessions.length === 0) {
    showStatus("There are no sessions to export.", "error");
    return;
  }

  try {
    const data = { sessions: sessions };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = "duotab-sessions-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();

    setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 1000);

    showStatus("Sessions exported.", "success");
  } catch (error) {
    console.error("DuoTab: could not export sessions.", error);
    showStatus("Could not export your sessions.", "error");
  }
}

function cleanImportedSession(rawSession) {
  if (!rawSession || typeof rawSession !== "object" || !Array.isArray(rawSession.tabs)) {
    return null;
  }

  const cleanTabs = [];

  for (const rawTab of rawSession.tabs) {
    if (!rawTab || typeof rawTab !== "object" || !isWebUrl(rawTab.url)) {
      continue;
    }

    cleanTabs.push({
      title:
        typeof rawTab.title === "string" && rawTab.title.trim()
          ? rawTab.title
          : rawTab.url,
      url: rawTab.url,
      favicon: safeFavicon(rawTab.favicon)
    });
  }

  if (cleanTabs.length === 0) {
    return null;
  }

  return {
    id: createId(),
    name:
      typeof rawSession.name === "string" && rawSession.name.trim()
        ? rawSession.name.trim()
        : "Imported session",
    createdAt:
      typeof rawSession.createdAt === "number" && Number.isFinite(rawSession.createdAt)
        ? rawSession.createdAt
        : Date.now(),
    tabs: cleanTabs
  };
}

async function importSessionsFromFile(file) {
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    let rawSessions = null;
    if (Array.isArray(parsed)) {
      rawSessions = parsed;
    } else if (parsed && Array.isArray(parsed.sessions)) {
      rawSessions = parsed.sessions;
    }

    if (!rawSessions) {
      showStatus("That file does not look like a DuoTab export.", "error");
      return;
    }

    const importedSessions = rawSessions
      .map(cleanImportedSession)
      .filter(function (session) {
        return session !== null;
      });

    if (importedSessions.length === 0) {
      showStatus("No valid sessions were found in that file.", "error");
      return;
    }

    const oldSessions = sessions;
    sessions = sessions.concat(importedSessions);

    const saved = await persistSessions();
    if (!saved) {
      sessions = oldSessions;
      return;
    }

    renderSessions();

    const skippedCount = rawSessions.length - importedSessions.length;
    let message = "Imported " + importedSessions.length + " session" +
      (importedSessions.length === 1 ? "." : "s.");
    if (skippedCount > 0) {
      message += " Skipped " + skippedCount + " invalid session" +
        (skippedCount === 1 ? "." : "s.");
    }
    showStatus(message, "success");
  } catch (error) {
    console.error("DuoTab: could not import sessions.", error);
    showStatus("Could not import that file. Choose a DuoTab JSON export.", "error");
  }
}

// ---------- Rendering ----------

function renderSessions() {
  const previousScrollTop = sessionList.scrollTop;
  const term = searchTerm.trim().toLowerCase();

  const visibleSessions = sessions
    .filter(function (session) {
      return !term || session.name.toLowerCase().includes(term);
    })
    .sort(function (a, b) {
      return b.createdAt - a.createdAt;
    });

  sessionList.replaceChildren();

  if (sessions.length === 0) {
    emptyState.hidden = false;
    emptyTitle.textContent = "No sessions yet";
    emptyText.textContent = "Open the tabs you want to keep, then save this window.";
  } else if (visibleSessions.length === 0) {
    emptyState.hidden = false;
    emptyTitle.textContent = "No matching sessions";
    emptyText.textContent = "Try a different search name.";
  } else {
    emptyState.hidden = true;
  }

  for (const session of visibleSessions) {
    sessionList.appendChild(createSessionCard(session));
  }

  updateSessionCount(visibleSessions.length);
  sessionList.scrollTop = previousScrollTop;
}

function updateSessionCount(visibleCount) {
  if (sessions.length === 0) {
    sessionCount.textContent = "";
    return;
  }

  if (searchTerm.trim()) {
    sessionCount.textContent = visibleCount + " of " + sessions.length;
    return;
  }

  sessionCount.textContent =
    sessions.length + (sessions.length === 1 ? " session" : " sessions");
}

function createSessionCard(session) {
  const isExpanded = expandedIds.has(session.id);

  const card = document.createElement("article");
  card.className = "session-card";
  card.dataset.sessionId = session.id;

  const toggleButton = document.createElement("button");
  toggleButton.type = "button";
  toggleButton.className = "session-toggle";
  toggleButton.setAttribute("aria-expanded", String(isExpanded));
  toggleButton.title = isExpanded ? "Hide tabs" : "Show tabs";

  toggleButton.addEventListener("click", function () {
    if (expandedIds.has(session.id)) {
      expandedIds.delete(session.id);
    } else {
      expandedIds.add(session.id);
    }
    renderSessions();
  });

  const textWrapper = document.createElement("span");
  textWrapper.className = "session-toggle-text";

  const name = document.createElement("span");
  name.className = "session-name";
  name.textContent = session.name;

  const meta = document.createElement("span");
  meta.className = "session-meta";
  meta.textContent = tabCountText(session.tabs.length) + " \u00b7 " + formatDate(session.createdAt);

  textWrapper.append(name, meta);

  const chevron = document.createElement("span");
  chevron.className = "chevron";
  chevron.setAttribute("aria-hidden", "true");
  chevron.textContent = "\u25be";

  toggleButton.append(textWrapper, chevron);

  const actions = document.createElement("div");
  actions.className = "session-actions";
  actions.append(
    createActionButton("Open", "primary", function () {
      openSession(session);
    }),
    createActionButton("Rename", "", function () {
      renameSession(session);
    }),
    createActionButton("Delete", "danger", function () {
      deleteSession(session);
    })
  );

  card.append(toggleButton, actions);

  if (isExpanded) {
    card.appendChild(createSessionDetails(session));
  }

  return card;
}

function createActionButton(label, extraClass, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "card-button" + (extraClass ? " " + extraClass : "");
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createSessionDetails(session) {
  const details = document.createElement("div");
  details.className = "session-details";

  if (session.tabs.length === 0) {
    const emptyTextElement = document.createElement("p");
    emptyTextElement.className = "tabs-empty";
    emptyTextElement.textContent = "No tabs in this session.";
    details.appendChild(emptyTextElement);
  } else {
    const tabList = document.createElement("div");
    tabList.className = "tab-list";

    for (const tab of session.tabs) {
      tabList.appendChild(createTabRow(session, tab));
    }

    details.appendChild(tabList);
  }

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "add-tab-button";
  addButton.textContent = "+ Add current tab";
  addButton.addEventListener("click", function () {
    addCurrentTabToSession(session.id);
  });

  details.appendChild(addButton);
  return details;
}

function createTabRow(session, tab) {
  const row = document.createElement("div");
  row.className = "tab-row";

  const favicon = document.createElement("img");
  favicon.className = "tab-favicon";
  favicon.alt = "";
  favicon.width = 14;
  favicon.height = 14;
  favicon.src = safeFavicon(tab.favicon) || DEFAULT_FAVICON;

  favicon.addEventListener("error", function () {
    favicon.src = DEFAULT_FAVICON;
  }, { once: true });

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "tab-open";
  openButton.textContent = tab.title || tab.url;
  openButton.title = tab.url;
  openButton.addEventListener("click", function () {
    openTabUrl(tab.url);
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "tab-remove";
  removeButton.textContent = "\u00d7";
  removeButton.title = "Remove tab";
  removeButton.setAttribute("aria-label", "Remove " + (tab.title || "tab"));
  removeButton.addEventListener("click", function () {
    removeTabFromSession(session.id, tab);
  });

  row.append(favicon, openButton, removeButton);
  return row;
}

// ---------- Theme ----------

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);

  const nextThemeLabel =
    theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  themeToggle.setAttribute("aria-label", nextThemeLabel);
  themeToggle.title = nextThemeLabel;
}

async function loadTheme() {
  // Follow the browser setting unless the user picked a theme before.
  let theme = darkModeQuery.matches ? "dark" : "light";

  try {
    const result = await chrome.storage.local.get(THEME_KEY);
    if (result[THEME_KEY] === "dark" || result[THEME_KEY] === "light") {
      theme = result[THEME_KEY];
    }
  } catch (error) {
    console.error("DuoTab: could not load theme choice.", error);
  }

  applyTheme(theme);
}

async function toggleTheme() {
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);

  try {
    await chrome.storage.local.set({ [THEME_KEY]: nextTheme });
  } catch (error) {
    console.error("DuoTab: could not save theme choice.", error);
    showStatus("Could not save your theme choice.", "error");
  }
}

// ---------- Start popup ----------

function bindEvents() {
  saveButton.addEventListener("click", saveCurrentWindow);

  sessionNameInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      saveCurrentWindow();
    }
  });

  searchInput.addEventListener("input", function () {
    searchTerm = searchInput.value;
    renderSessions();
    sessionList.scrollTop = 0;
  });

  themeToggle.addEventListener("click", toggleTheme);
  exportButton.addEventListener("click", exportSessions);
  importButton.addEventListener("click", function () {
    importFileInput.click();
  });

  importFileInput.addEventListener("change", async function () {
    const file = importFileInput.files && importFileInput.files[0];
    importFileInput.value = "";
    if (file) {
      await importSessionsFromFile(file);
    }
  });
}

async function init() {
  await loadTheme();
  sessions = await loadSessions();
  renderSessions();
  bindEvents();
}

init();
