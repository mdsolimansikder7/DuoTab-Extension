// DuoTab background service worker.
// Real data lives in chrome.storage. The worker can sleep at any time.

const LIVE_KEY = "liveSessions";          // chrome.storage.local
const TAB_MAP_KEY = "liveTabMap";         // chrome.storage.session
const DEFAULT_URL_KEY = "liveDefaultUrl"; // chrome.storage.local
const JARS_KEY = "sessionJars";           // chrome.storage.local
const RULE_ID_BASE = 1000000;
const MAX_DOMAIN_RULES = 40;
const RULE_COUNTER_KEY = "druleCounter";  // chrome.storage.session

// Cookie routing is always enabled. Set to false to disable for debugging.
const COOKIE_ROUTING_ENABLED = true;

const SESSION_COLORS = [
  "#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ef4444",
  "#ec4899", "#8b5cf6", "#22c55e", "#f97316", "#06b6d4"
];

// Small queue so quick events do not overwrite each other while the worker is awake.
// It is not saved state; all real data is read from and written to storage.
let workQueue = Promise.resolve();

function withLock(task) {
  const run = workQueue.then(task, task);
  workQueue = run.catch(function () {});
  return run;
}

function createId() {
  return "s" + Date.now() + Math.random().toString(36).slice(2, 7);
}

function isWebUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function isOpenableUrl(value) {
  return value === "about:blank" || isWebUrl(value);
}

function cleanColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#6366f1";
}

// Turn typed text into a safe tab URL. Returns null for invalid input.
function normalizeNewUrl(value) {
  if (typeof value !== "string") return "about:blank";
  let text = value.trim();
  if (!text) return "about:blank";
  const lower = text.toLowerCase();
  if (lower === "about:blank" || lower === "about.blank") return "about:blank";
  if (!/^https?:\/\//i.test(text)) {
    text = "https://" + text;
  }
  try {
    const url = new URL(text);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch (error) {
    // Invalid URL.
  }
  return null;
}

function cleanTabRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!Number.isInteger(raw.tabId)) return null;
  if (typeof raw.url !== "string") return null;
  return {
    tabId: raw.tabId,
    url: raw.url,
    title: typeof raw.title === "string" ? raw.title : ""
  };
}

function cleanClosedTab(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!isOpenableUrl(raw.url)) return null;
  return {
    url: raw.url,
    title: typeof raw.title === "string" ? raw.title : raw.url
  };
}

function cleanSession(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.id !== "string") return null;
  if (!Number.isInteger(raw.number) || raw.number < 1) return null;
  if (!Array.isArray(raw.tabs)) return null;
  if (!Array.isArray(raw.closedTabs)) raw.closedTabs = [];

  const tabs = raw.tabs.map(cleanTabRecord).filter(Boolean);
  const closedTabs = raw.closedTabs.map(cleanClosedTab).filter(Boolean);

  return {
    id: raw.id,
    number: raw.number,
    name: typeof raw.name === "string" && raw.name.trim()
      ? raw.name
      : "Session " + raw.number,
    color: cleanColor(raw.color),
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    tabs: tabs,
    closedTabs: closedTabs,
    closedAt: typeof raw.closedAt === "number" ? raw.closedAt : null
  };
}

async function getSessions() {
  const result = await chrome.storage.local.get(LIVE_KEY);
  const raw = result[LIVE_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.map(cleanSession).filter(Boolean);
}

async function saveSessions(sessions) {
  await chrome.storage.local.set({ [LIVE_KEY]: sessions });
}

async function getTabMap() {
  try {
    const result = await chrome.storage.session.get(TAB_MAP_KEY);
    const raw = result[TAB_MAP_KEY];
    const map = {};
    if (!raw || typeof raw !== "object") return map;
    for (const [key, value] of Object.entries(raw)) {
      const tabId = Number(key);
      if (Number.isInteger(tabId) && typeof value === "string") {
        map[tabId] = value;
      }
    }
    return map;
  } catch (error) {
    console.error("DuoTab: could not read the tab map.", error);
    return {};
  }
}

async function saveTabMap(map) {
  try {
    await chrome.storage.session.set({ [TAB_MAP_KEY]: map });
  } catch (error) {
    console.error("DuoTab: could not save the tab map.", error);
  }
}

async function getDefaultUrl() {
  const result = await chrome.storage.local.get(DEFAULT_URL_KEY);
  return typeof result[DEFAULT_URL_KEY] === "string" ? result[DEFAULT_URL_KEY] : "";
}

async function getNextRuleId() {
  try {
    const result = await chrome.storage.session.get(RULE_COUNTER_KEY);
    let next = Number.isInteger(result[RULE_COUNTER_KEY]) && result[RULE_COUNTER_KEY] > 0
      ? result[RULE_COUNTER_KEY]
      : 1;
    await chrome.storage.session.set({ [RULE_COUNTER_KEY]: next + 1 });
    return RULE_ID_BASE + next;
  } catch (error) {
    console.error("DuoTab: could not get next rule id.", error);
    return RULE_ID_BASE + Date.now();
  }
}

async function resetRuleCounter() {
  try {
    await chrome.storage.session.set({ [RULE_COUNTER_KEY]: 1 });
  } catch (error) {
    console.error("DuoTab: could not reset rule counter.", error);
  }
}

async function getNextNumber(sessions) {
  const used = new Set();
  for (const session of sessions) {
    if (Number.isInteger(session.number) && session.number > 0) {
      used.add(session.number);
    }
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

function findSession(sessions, sessionId) {
  return sessions.find(function (session) {
    return session.id === sessionId;
  }) || null;
}

function addClosedTab(session, record) {
  if (!isOpenableUrl(record.url)) return;
  const exists = session.closedTabs.some(function (item) {
    return item.url === record.url;
  });
  if (!exists) {
    session.closedTabs.push({ url: record.url, title: record.title || record.url });
  }
  session.closedAt = Date.now();
}

// Move tabs that no longer exist into closedTabs.
function pruneStaleTabs(session, liveTabIds) {
  let changed = false;
  const keep = [];
  for (const record of session.tabs) {
    if (liveTabIds.has(record.tabId)) {
      keep.push(record);
    } else {
      addClosedTab(session, record);
      changed = true;
    }
  }
  session.tabs = keep;
  if (session.tabs.length === 0 && session.closedTabs.length > 0) {
    session.closedAt = session.closedAt || Date.now();
  }
  return changed;
}

function publicSession(session) {
  return {
    id: session.id,
    number: session.number,
    name: session.name,
    color: session.color,
    createdAt: session.createdAt,
    openTabs: session.tabs.length,
    closedTabCount: session.closedTabs.length,
    tabs: session.tabs.map(function (tab) {
      return { url: tab.url, title: tab.title };
    }),
    closedTabs: session.closedTabs.map(function (tab) {
      return { url: tab.url, title: tab.title };
    })
  };
}

// ---------- Session actions ----------

async function createSessions(count, defaultUrl, activateFirst) {
  const url = normalizeNewUrl(defaultUrl);
  if (url === null) {
    return { ok: false, error: "Enter a valid http or https URL, or leave it blank for about:blank." };
  }

  return withLock(async function () {
    const sessions = await getSessions();
    const map = await getTabMap();
    let number = await getNextNumber(sessions);
    const created = [];

    for (let index = 0; index < count; index++) {
      let tab;
      try {
        // Create tab with about:blank first, then navigate after rules are installed
        tab = await chrome.tabs.create({
          url: "about:blank",
          active: activateFirst && index === 0
        });
      } catch (error) {
        console.error("DuoTab: could not create a session tab.", error);
        break;
      }

      const session = {
        id: createId(),
        number: number,
        name: "Session " + number,
        color: SESSION_COLORS[(number - 1) % SESSION_COLORS.length],
        createdAt: Date.now(),
        tabs: [{
          tabId: tab.id,
          url: url,
          title: ""
        }],
        closedTabs: [],
        closedAt: null
      };

      sessions.push(session);
      map[tab.id] = session.id;
      console.log("[DuoTab DEBUG] New session tab registered:", { tabId: tab.id, sessionId: session.id, sessionNumber: session.number });
      created.push(session);
      number++;
    }

    if (created.length === 0) {
      return { ok: false, error: "Could not open a new tab." };
    }

    await saveSessions(sessions);
    await saveTabMap(map);
    await chrome.storage.local.set({ [DEFAULT_URL_KEY]: url });

    if (COOKIE_ROUTING_ENABLED) {
      for (const session of created) {
        try {
          await refreshRoutingRulesForSession(session.id);
        } catch (error) {
          console.error("DuoTab: could not apply routing rules to new session.", error);
        }
      }
    }

    // Now navigate tabs to the target URL
    for (const session of created) {
      const tabId = session.tabs[0].tabId;
      try {
        await chrome.tabs.update(tabId, { url: url });
      } catch (error) {
        console.error("DuoTab: could not navigate new session tab.", error);
      }
      await setBadge(tabId, session);
    }

    return { ok: true, created: created.map(publicSession) };
  });
}

async function addTabToSession(sessionId, active) {
  return withLock(async function () {
    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) {
      return { ok: false, error: "That session no longer exists." };
    }

    const defaultUrl = await getDefaultUrl();
    const url = normalizeNewUrl(defaultUrl) || "about:blank";
    let tab;
    try {
      // Create tab with about:blank first, then navigate after rules are installed
      tab = await chrome.tabs.create({ url: "about:blank", active: Boolean(active) });
    } catch (error) {
      console.error("DuoTab: could not open another session tab.", error);
      return { ok: false, error: "Could not open a new tab." };
    }

    const map = await getTabMap();
    session.tabs.push({
      tabId: tab.id,
      url: url,
      title: ""
    });
    session.closedAt = null;
    map[tab.id] = session.id;
    console.log("[DuoTab DEBUG] Tab added to session:", { tabId: tab.id, sessionId: session.id });

    await saveSessions(sessions);
    await saveTabMap(map);

    if (COOKIE_ROUTING_ENABLED) {
      try {
        await applyRoutingRulesForTab(tab.id, session);
      } catch (error) {
        console.error("DuoTab: could not apply routing rules to the new tab.", error);
      }
    }

    // Now navigate the tab to the target URL
    try {
      await chrome.tabs.update(tab.id, { url: url });
    } catch (error) {
      console.error("DuoTab: could not navigate added session tab.", error);
    }

    await setBadge(tab.id, session);

    return { ok: true, session: publicSession(session) };
  });
}

async function focusSession(sessionId) {
  const sessions = await getSessions();
  const session = findSession(sessions, sessionId);
  if (!session) {
    return { ok: false, error: "That session no longer exists." };
  }

  for (const record of session.tabs) {
    try {
      const tab = await chrome.tabs.get(record.tabId);
      await chrome.tabs.update(tab.id, { active: true });
      if (Number.isInteger(tab.windowId)) {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      return { ok: true, focused: true };
    } catch (error) {
      // Try the next saved tab.
    }
  }

  return reopenSession(sessionId);
}

async function reopenSession(sessionId) {
  return withLock(async function () {
    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) {
      return { ok: false, error: "That session no longer exists." };
    }

    const liveTabs = await chrome.tabs.query({});
    const liveIds = new Set(liveTabs.map(function (tab) { return tab.id; }));
    const changed = pruneStaleTabs(session, liveIds);

    if (session.tabs.length > 0) {
      if (changed) await saveSessions(sessions);
      return { ok: true, alreadyOpen: true, count: session.tabs.length };
    }

    const urls = session.closedTabs
      .map(function (tab) { return tab.url; })
      .filter(isOpenableUrl);

    if (urls.length === 0) {
      if (changed) await saveSessions(sessions);
      return { ok: false, error: "This session has no saved tabs to reopen." };
    }

    const map = await getTabMap();
    const opened = [];

    for (let index = 0; index < urls.length; index++) {
      try {
        // Create tab with about:blank first, then navigate after rules are installed
        const tab = await chrome.tabs.create({
          url: "about:blank",
          active: index === 0
        });
        opened.push({
          tabId: tab.id,
          url: urls[index],
          title: ""
        });
        map[tab.id] = session.id;
        console.log("[DuoTab DEBUG] Reopened session tab:", { tabId: tab.id, sessionId: session.id, url: urls[index] });
      } catch (error) {
        console.error("DuoTab: could not reopen a saved tab.", error);
      }
    }

    if (opened.length === 0) {
      if (changed) await saveSessions(sessions);
      return { ok: false, error: "Could not reopen the saved tabs." };
    }

    session.tabs = opened;
    session.closedTabs = [];
    session.closedAt = null;
    await saveSessions(sessions);
    await saveTabMap(map);

    if (COOKIE_ROUTING_ENABLED) {
      for (const record of opened) {
        try {
          await applyRoutingRulesForTab(record.tabId, session);
        } catch (error) {
          console.error("DuoTab: could not apply routing rules to a reopened tab.", error);
        }
      }
    }

    // Now navigate tabs to their target URLs
    for (const record of opened) {
      try {
        await chrome.tabs.update(record.tabId, { url: record.url });
      } catch (error) {
        console.error("DuoTab: could not navigate reopened session tab.", error);
      }
      await setBadge(record.tabId, session);
    }

    return { ok: true, count: opened.length };
  });
}

async function deleteSession(sessionId) {
  return withLock(async function () {
    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) {
      return { ok: false, error: "That session no longer exists." };
    }

    const tabIds = session.tabs.map(function (tab) { return tab.tabId; });
    const map = await getTabMap();

    for (const tabId of tabIds) {
      await removeRoutingRulesForTab(tabId);
    }
    for (const tabId of tabIds) {
      delete map[tabId];
    }

    await saveSessions(sessions.filter(function (item) {
      return item.id !== sessionId;
    }));
    await saveTabMap(map);

    for (const tabId of tabIds) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (error) {
        // The tab was already closed.
      }
    }

    return { ok: true };
  });
}

async function importSessions(rawSessions) {
  return withLock(async function () {
    const sessions = await getSessions();
    const usedNumbers = new Set(sessions.map(function (session) {
      return session.number;
    }));
    let next = await getNextNumber(sessions);
    let imported = 0;
    let skipped = 0;

    for (const raw of rawSessions) {
      if (!raw || typeof raw !== "object") {
        skipped++;
        continue;
      }

      const urls = [];
      const seen = new Set();
      const lists = [];
      if (Array.isArray(raw.tabs)) lists.push(raw.tabs);
      if (Array.isArray(raw.closedTabs)) lists.push(raw.closedTabs);

      for (const list of lists) {
        for (const item of list) {
          const url = typeof item === "string" ? item : item && item.url;
          if (!isOpenableUrl(url) || seen.has(url)) continue;
          seen.add(url);
          urls.push({
            url: url,
            title: item && typeof item.title === "string" ? item.title : url
          });
        }
      }

      if (urls.length === 0) {
        skipped++;
        continue;
      }

      let number = Number.isInteger(raw.number) && raw.number > 0 && !usedNumbers.has(raw.number)
        ? raw.number
        : next;
      while (usedNumbers.has(number)) number++;
      usedNumbers.add(number);
      next = Math.max(next, number + 1);

      const name = typeof raw.name === "string" && raw.name.trim()
        ? raw.name.trim().slice(0, 80)
        : "Session " + number;

      sessions.push({
        id: createId(),
        number: number,
        name: name,
        color: /^#[0-9a-f]{6}$/i.test(raw.color || "")
          ? raw.color
          : SESSION_COLORS[(number - 1) % SESSION_COLORS.length],
        createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
        tabs: [],
        closedTabs: urls,
        closedAt: Date.now()
      });
      imported++;
    }

    if (imported > 0) {
      await saveSessions(sessions);
    }

    return { ok: true, imported: imported, skipped: skipped };
  });
}

async function getState(tabId) {
  const sessions = await getSessions();
  const map = await getTabMap();
  const defaultUrl = await getDefaultUrl();
  const currentSessionId = Number.isInteger(tabId) ? map[tabId] || null : null;
  const current = currentSessionId ? findSession(sessions, currentSessionId) : null;

    return {
      ok: true,
      sessions: sessions.map(publicSession),
      defaultUrl: defaultUrl,
      currentSession: current ? { ...publicSession(current), number: current.number } : null,
      experimental: COOKIE_ROUTING_ENABLED
    };
}

// ---------- Per-tab cookie routing ----------
// Each session keeps its own cookie jar in chrome.storage.local. Declarative
// Net Request rules keep the real browser jar clean and inject the session's
// cookies on requests from session tabs only. Not full isolation.

async function getJar(sessionId) {
  const result = await chrome.storage.local.get(JARS_KEY);
  const all = result[JARS_KEY] || {};
  const jar = all[sessionId];
  return jar && Array.isArray(jar.cookies) ? jar : { cookies: [] };
}

async function saveJar(sessionId, jar) {
  const result = await chrome.storage.local.get(JARS_KEY);
  const all = result[JARS_KEY] || {};
  all[sessionId] = jar;
  await chrome.storage.local.set({ [JARS_KEY]: all });
}

function cookieMatches(cookie, url) {
  const domain = (cookie.domain || "").replace(/^\./, "");
  const host = url.hostname;
  if (host !== domain && !host.endsWith("." + domain)) return false;
  const path = cookie.path || "/";
  if (!url.pathname.startsWith(path)) return false;
  if (cookie.secure && url.protocol !== "https:") return false;
  if (cookie.expires && Date.now() >= cookie.expires) return false;
  return true;
}

function parseSetCookie(headerValue, requestUrl) {
  const parts = String(headerValue)
    .split(";")
    .map(function (part) {
      return part.trim();
    })
    .filter(Boolean);
  const first = parts[0] || "";
  const equals = first.indexOf("=");
  const name = equals < 0 ? first : first.slice(0, equals).trim();
  const value = equals < 0 ? "" : first.slice(equals + 1).trim();
  let domain = "";
  try {
    domain = new URL(requestUrl).hostname;
  } catch (error) {}
  let path = "/";
  let secure = false;
  let httpOnly = false;
  let expires = null;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    const eq = part.indexOf("=");
    const key = eq < 0 ? part : part.slice(0, eq);
    const val = eq < 0 ? "" : part.slice(eq + 1);
    switch (key.toLowerCase()) {
      case "domain":
        domain = val.replace(/^\./, "");
        break;
      case "path":
        path = val;
        break;
      case "secure":
        secure = true;
        break;
      case "httponly":
        httpOnly = true;
        break;
      case "expires": {
        const time = Date.parse(val);
        if (Number.isFinite(time)) expires = time;
        break;
      }
    }
  }
  return { name, value, domain, path, secure, httpOnly, expires };
}

async function addCookiesToJar(sessionId, cookies) {
  const jar = await getJar(sessionId);
  let changed = false;
  for (const cookie of cookies) {
    if (!cookie.name) continue;
    const index = jar.cookies.findIndex(function (c) {
      return c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path;
    });
    if (index >= 0) jar.cookies[index] = cookie;
    else jar.cookies.push(cookie);
    changed = true;
  }
  if (changed) {
    jar.cookies.sort(function (a, b) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    if (jar.cookies.length > 500) jar.cookies = jar.cookies.slice(0, 500);
    await saveJar(sessionId, jar);
    console.log("[DuoTab DEBUG] Jar updated:", { sessionId, cookieCount: jar.cookies.length, cookies: jar.cookies.map(c => c.name + "=" + c.value) });
  }
  return changed;
}

async function removeRoutingRulesForTab(tabId) {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ids = rules
      .filter(function (rule) {
        return Number.isInteger(rule.id) && rule.id >= RULE_ID_BASE && Array.isArray(rule.condition?.tabIds) && rule.condition.tabIds.includes(tabId);
      })
      .map(function (rule) { return rule.id; });
    if (ids.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
      console.log("[DuoTab DEBUG] Removed routing rules for tab:", { tabId, ruleIds: ids });
    }
  } catch (error) {
    console.error("DuoTab: could not remove routing rules for tab:", { tabId, error: String(error) });
  }
}

async function clearAllRoutingRules() {
  try {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ids = rules
      .map(function (rule) {
        return rule.id;
      })
      .filter(function (id) {
        return Number.isInteger(id) && id >= RULE_ID_BASE;
      });
    if (ids.length) {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
      console.log("[DuoTab DEBUG] Cleared all routing rules:", { count: ids.length });
    }
  } catch (error) {
    console.error("DuoTab: could not clear routing rules.", error);
  }
}

async function applyRoutingRulesForTab(tabId, session) {
  await removeRoutingRulesForTab(tabId);
  if (!COOKIE_ROUTING_ENABLED) return;

  console.log("[DuoTab DEBUG] applyRoutingRulesForTab called:", { tabId, sessionId: session.id });

  const jar = await getJar(session.id);
  console.log("[DuoTab DEBUG] Session jar contents:", { sessionId: session.id, jar });
  const byDomain = new Map();
  for (const cookie of jar.cookies || []) {
    if (!cookie.domain) continue;
    // Strip leading dot from domain for consistent grouping
    const domain = cookie.domain.replace(/^\./, "");
    const list = byDomain.get(domain) || [];
    list.push(cookie);
    byDomain.set(domain, list);
  }

  const domains = [...byDomain.keys()].sort(function (a, b) {
    return a.length - b.length;
  });
  const selected = [];
  for (const domain of domains) {
    if (selected.some(function (other) {
      return domain.endsWith("." + other) || other.endsWith("." + domain);
    })) continue;
    selected.push(domain);
    if (selected.length >= MAX_DOMAIN_RULES) break;
  }

  const rules = [];
  const ALL_RESOURCE_TYPES = [
    "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
    "object", "xmlhttprequest", "ping", "media", "websocket", "webtransport", "other"
  ];

  // Lowest priority: never let the real browser jar leak into session tabs.
  rules.push({
    id: await getNextRuleId(),
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "cookie", operation: "remove" }]
    },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES }
  });
  // Block incoming Set-Cookie so the real jar is not polluted.
  rules.push({
    id: await getNextRuleId(),
    priority: 1,
    action: {
      type: "modifyHeaders",
      responseHeaders: [{ header: "set-cookie", operation: "remove" }]
    },
    condition: { tabIds: [tabId], resourceTypes: ALL_RESOURCE_TYPES }
  });

  const now = Date.now();
  for (const domain of selected) {
    const domainCookies = (byDomain.get(domain) || []).filter(function (c) {
      return !c.expires || c.expires > now;
    });
    if (!domainCookies.length) continue;
    const value = domainCookies
      .sort(function (a, b) {
        return (b.path || "/").length - (a.path || "/").length;
      })
      .map(function (c) {
        return c.name + "=" + c.value;
      })
      .join("; ");
    rules.push({
      id: await getNextRuleId(),
      priority: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "cookie", operation: "set", value: value }]
      },
      condition: { tabIds: [tabId], requestDomains: [domain], resourceTypes: ALL_RESOURCE_TYPES }
    });
  }

  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: rules });
    console.log("[DuoTab DEBUG] Rules added for tab:", { tabId, ruleCount: rules.length, ruleIds: rules.map(r => r.id) });
    
    // Debug: fetch and log all session rules
    const allRules = await chrome.declarativeNetRequest.getSessionRules();
    const ourRules = allRules.filter(r => r.id >= RULE_ID_BASE);
    console.log("[DuoTab DEBUG] Current session rules (ours):", ourRules);
  } catch (error) {
    console.error("DuoTab: could not add routing rules.", { error: String(error), stack: error?.stack });
  }
}

async function refreshRoutingRulesForSession(sessionId) {
  console.log("[DuoTab DEBUG] refreshRoutingRulesForSession:", { sessionId });
  const sessions = await getSessions();
  const session = findSession(sessions, sessionId);
  if (!session) return;
  for (const tab of session.tabs) {
    await applyRoutingRulesForTab(tab.tabId, session);
  }
}

// ---------- Tab tracking ----------

async function updateTabRecord(tabId, tab) {
  const map = await getTabMap();
  const sessionId = map[tabId];
  if (!sessionId) return;

  const sessions = await getSessions();
  const session = findSession(sessions, sessionId);
  if (!session) return;

  const record = session.tabs.find(function (item) {
    return item.tabId === tabId;
  });
  if (!record) return;

  const nextUrl = tab.url || tab.pendingUrl || record.url;
  const nextTitle = tab.title || record.title || "";
  if (nextUrl === record.url && nextTitle === record.title) return;

  record.url = nextUrl;
  record.title = nextTitle;
  await saveSessions(sessions);
}

async function handleOpenedFromSession(tab) {
  if (!tab || !Number.isInteger(tab.id)) return;

  // The onCreated event does not always include openerTabId, so read the tab again.
  let info = tab;
  if (!Number.isInteger(info.openerTabId)) {
    try {
      info = await chrome.tabs.get(tab.id);
    } catch (error) {
      return;
    }
  }
  if (!Number.isInteger(info.openerTabId)) return;

  await withLock(async function () {
    const map = await getTabMap();
    const sessionId = map[info.openerTabId];
    if (!sessionId || map[info.id]) return;

    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) return;

    session.tabs.push({
      tabId: info.id,
      url: info.url || info.pendingUrl || "about:blank",
      title: info.title || ""
    });
    session.closedAt = null;
    map[info.id] = session.id;
    console.log("[DuoTab DEBUG] Tab opened from session link:", { tabId: info.id, openerTabId: info.openerTabId, sessionId: session.id, note: "Rules installed after first request; first navigation may leak to real jar." });

    await saveSessions(sessions);
    await saveTabMap(map);
    await setBadge(info.id, session);

    if (COOKIE_ROUTING_ENABLED) {
      try {
        await applyRoutingRulesForTab(info.id, session);
      } catch (error) {
        console.error("DuoTab: could not apply routing rules to the opened tab.", error);
      }
    }
  });
}

async function handleTabRemoved(tabId) {
  await withLock(async function () {
    const map = await getTabMap();
    const sessionId = map[tabId];
    delete map[tabId];

    if (!sessionId) {
      await saveTabMap(map);
      return;
    }

    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) {
      await saveTabMap(map);
      return;
    }

    const index = session.tabs.findIndex(function (item) {
      return item.tabId === tabId;
    });
    if (index >= 0) {
      const record = session.tabs[index];
      session.tabs.splice(index, 1);
      addClosedTab(session, record);
    }

    await saveSessions(sessions);
    await saveTabMap(map);
    await removeRoutingRulesForTab(tabId);
  });
}

async function setBadge(tabId, session) {
  try {
    if (!Number.isInteger(tabId)) return;
    // Set the text first so a color error cannot hide the session number.
    await chrome.action.setBadgeText({ tabId: tabId, text: String(session.number) });
    try {
      await chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: session.color });
      if (chrome.action.setBadgeTextColor) {
        await chrome.action.setBadgeTextColor({ tabId: tabId, color: "#ffffff" });
      }
    } catch (error) {
      console.error("DuoTab: could not set the badge color.", error);
    }
  } catch (error) {
    console.error("DuoTab: could not set the badge text.", error);
  }
}

async function updateBadge(tabId) {
  try {
    if (!Number.isInteger(tabId)) return;
    const map = await getTabMap();
    const sessionId = map[tabId];
    if (!sessionId) {
      // A brand new tab may not have its map entry yet. Do not clear the badge here.
      return;
    }

    const sessions = await getSessions();
    const session = findSession(sessions, sessionId);
    if (!session) {
      await chrome.action.setBadgeText({ tabId: tabId, text: "" });
      return;
    }

    await setBadge(tabId, session);
  } catch (error) {
    console.error("DuoTab: could not update the badge.", error);
  }
}

async function startupCleanup() {
  try {
    await resetRuleCounter();
    await clearAllRoutingRules();
    const liveTabs = await chrome.tabs.query({});
    const liveIds = new Set(liveTabs.map(function (tab) { return tab.id; }));
    const map = await getTabMap();
    let mapChanged = false;

    for (const key of Object.keys(map)) {
      const tabId = Number(key);
      if (!liveIds.has(tabId)) {
        delete map[tabId];
        mapChanged = true;
      }
    }

    const sessions = await getSessions();
    let sessionsChanged = false;
    for (const session of sessions) {
      if (pruneStaleTabs(session, liveIds)) sessionsChanged = true;
    }

    if (mapChanged) await saveTabMap(map);
    if (sessionsChanged) await saveSessions(sessions);

    // Refresh badges for every open tab.
    for (const tab of liveTabs) {
      await updateBadge(tab.id);
    }
  } catch (error) {
    console.error("DuoTab: startup cleanup failed.", error);
  }
}

// ---------- Events ----------

// Must be registered at the top level so the worker wakes for these events.
chrome.tabs.onCreated.addListener(function (tab) {
  handleOpenedFromSession(tab).catch(function (error) {
    console.error("DuoTab: could not attach a new tab.", error);
  });
  updateBadge(tab.id);
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
  if (!changeInfo.url && !changeInfo.title) {
    if (changeInfo.status === "complete") updateBadge(tabId);
    return;
  }
  updateTabRecord(tabId, tab).catch(function (error) {
    console.error("DuoTab: could not update a tab.", error);
  });
  if (changeInfo.status === "complete" || changeInfo.url) {
    updateBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  handleTabRemoved(tabId).catch(function (error) {
    console.error("DuoTab: could not handle a closed tab.", error);
  });
});

chrome.tabs.onActivated.addListener(function (activeInfo) {
  updateBadge(activeInfo.tabId);
});

chrome.runtime.onStartup.addListener(function () {
  startupCleanup();
});

chrome.runtime.onInstalled.addListener(function () {
  startupCleanup();
});

// ---------- Messages from the popup ----------

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== "string") return false;

  // Run the action, then reply. Returning true keeps the message channel open.
  const run = (async function () {
    switch (message.type) {
      case "get-state":
        return getState(Number.isInteger(message.tabId) ? message.tabId : null);

      case "duotab-context": {
        const tab = sender && sender.tab;
        if (!tab || !Number.isInteger(tab.id)) {
          return { ok: false, error: "No tab available." };
        }
        const map = await getTabMap();
        const sessionId = map[tab.id];
        if (!sessionId) {
          return { ok: true, sessionId: null, sessionNumber: null, enabled: COOKIE_ROUTING_ENABLED, jar: { cookies: [] } };
        }
        const sessions = await getSessions();
        const session = findSession(sessions, sessionId);
        const jar = await getJar(sessionId);
        return { ok: true, sessionId: sessionId, sessionNumber: session ? session.number : null, enabled: COOKIE_ROUTING_ENABLED, jar: jar };
      }

      case "duotab-jar-update": {
        if (!message.sessionId || !message.cookie || !message.cookie.name) {
          return { ok: false, error: "Bad cookie update." };
        }
        await addCookiesToJar(message.sessionId, [message.cookie]);
        await refreshRoutingRulesForSession(message.sessionId);
        return { ok: true };
      }

      case "create-session":
        return createSessions(1, message.defaultUrl, true);

      case "create-many": {
        const count = Number(message.count);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          return { ok: false, error: "Choose between 1 and 100 sessions per click." };
        }
        return createSessions(count, message.defaultUrl, false);
      }

      case "add-tab":
        return addTabToSession(message.sessionId, true);

      case "focus-session":
        return focusSession(message.sessionId);

      case "reopen-session":
        return reopenSession(message.sessionId);

      case "delete-session":
        return deleteSession(message.sessionId);

      case "import-sessions": {
        if (!Array.isArray(message.sessions)) {
          return { ok: false, error: "That file does not contain a sessions array." };
        }
        return importSessions(message.sessions);
      }

      case "debug-dump": {
        const sessions = await getSessions();
        const map = await getTabMap();
        const allRules = await chrome.declarativeNetRequest.getSessionRules();
        const ourRules = allRules.filter(r => r.id >= RULE_ID_BASE);
        const jars = {};
        for (const session of sessions) {
          jars[session.id] = await getJar(session.id);
        }
        return { ok: true, sessions, tabMap: map, sessionRules: ourRules, jars };
      }

      case "debug-rules": {
        const allRules = await chrome.declarativeNetRequest.getSessionRules();
        const ourRules = allRules.filter(r => r.id >= RULE_ID_BASE);
        const byTab = {};
        for (const rule of ourRules) {
          const tabIds = rule.condition?.tabIds || [];
          for (const tabId of tabIds) {
            byTab[tabId] = byTab[tabId] || [];
            byTab[tabId].push({ id: rule.id, priority: rule.priority, action: rule.action, condition: rule.condition });
          }
        }
        return { ok: true, rulesByTab: byTab, totalOurRules: ourRules.length, totalAllRules: allRules.length };
      }

      default:
        return { ok: false, error: "Unknown DuoTab action." };
    }
  })();

  run.then(sendResponse).catch(function (error) {
    console.error("DuoTab: action failed.", error);
    sendResponse({ ok: false, error: "Something went wrong. Please try again." });
  });

  return true;
});

// Capture Set-Cookie from session-tab responses and store it in the session jar.
// Non-blocking: the browser's real jar is kept clean by declarativeNetRequest rules.
chrome.webRequest.onHeadersReceived.addListener(function (details) {
  if (!COOKIE_ROUTING_ENABLED) return;
  if (!Number.isInteger(details.tabId) || details.tabId < 0) return;

  withLock(async function () {
    const map = await getTabMap();
    console.log("[DuoTab DEBUG] webRequest tabMap snapshot:", { tabId: details.tabId, mapKeys: Object.keys(map), map });
    const sessionId = map[details.tabId];
    if (!sessionId) {
      console.log("[DuoTab DEBUG] No session for tab:", { tabId: details.tabId, url: details.url, method: details.method, frameId: details.frameId });
      return;
    }

    console.log("[DuoTab DEBUG] Set-Cookie captured:", { tabId: details.tabId, sessionId, url: details.url, method: details.method, frameId: details.frameId });

    const headers = details.responseHeaders || [];
    const setCookies = headers
      .filter(function (header) {
        return header.name && header.name.toLowerCase() === "set-cookie";
      })
      .map(function (header) { return header.value || ""; });
    if (!setCookies.length) return;

    console.log("[DuoTab DEBUG] Set-Cookie values:", setCookies);

    const parsed = setCookies.map(function (value) {
      return parseSetCookie(value, details.url || "");
    });
    if (await addCookiesToJar(sessionId, parsed)) {
      await refreshRoutingRulesForSession(sessionId);
    }
  }).catch(function (error) {
    console.error("DuoTab: could not capture session cookies.", error);
  });
}, { urls: ["<all_urls>"] }, ["responseHeaders", "extraHeaders"]);
