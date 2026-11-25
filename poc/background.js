// Phase 2 proof of concept. This is NOT the production extension.
// It tests reading Set-Cookie, blocking Set-Cookie, rewriting Cookie, and document.cookie.

const TEST_ORIGIN = "http://127.0.0.1:8130";
const LOG_KEY = "pocLog";
const RESULTS_KEY = "pocResults";
const PAGE_REPORT_KEY = "pocPageReport";
const HYBRID_KEY = "pocHybridJar";
const RULE_IDS = [11, 12, 13, 14, 15];

// Set only while test f runs.
let hybridTabId = null;
const ALL_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket",
  "webtransport", "webbundle", "other"
];

let logQueue = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function addLog(entry) {
  logQueue = logQueue.then(async function () {
    const result = await chrome.storage.local.get(LOG_KEY);
    const logs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
    logs.push(entry);
    await chrome.storage.local.set({ [LOG_KEY]: logs.slice(-300) });
  }).catch(function () {});
  return logQueue;
}

async function getLogs() {
  const result = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
}

async function clearLogs() {
  await chrome.storage.local.set({ [LOG_KEY]: [] });
}

async function clearRules() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: RULE_IDS });
}

async function clearCookies() {
  const cookies = await chrome.cookies.getAll({ domain: "127.0.0.1" });
  for (const cookie of cookies) {
    try {
      await chrome.cookies.remove({
        url: TEST_ORIGIN + (cookie.path || "/"),
        name: cookie.name
      });
    } catch (error) {
      // Ignore a cookie that disappeared.
    }
  }
}

async function waitComplete(tabId, timeout = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") return true;
    } catch (error) {
      return false;
    }
    await sleep(100);
  }
  return false;
}

async function resetServerLog() {
  try {
    await fetch(TEST_ORIGIN + "/reset-log");
  } catch (error) {
    // The local test server may not be running yet.
  }
}

async function getServerLog() {
  const response = await fetch(TEST_ORIGIN + "/log");
  return await response.json();
}

async function closeTab(tabId) {
  try {
    await chrome.tabs.remove(tabId);
  } catch (error) {
    // Already closed.
  }
}

async function runA() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await resetServerLog();

  const tab = await chrome.tabs.create({
    url: TEST_ORIGIN + "/set-cookie?name=a&value=from-server",
    active: false
  });
  await waitComplete(tab.id);
  await sleep(400);

  const cookie = await chrome.cookies.get({ url: TEST_ORIGIN + "/", name: "a" });
  const logs = await getLogs();
  const responseLogs = logs.filter(function (entry) {
    return entry.kind === "response" && entry.tabId === tab.id;
  });

  await closeTab(tab.id);
  return {
    setCookieHeaders: responseLogs.flatMap(function (entry) {
      return entry.setCookie || [];
    }),
    cookieInJar: cookie ? cookie.value : null
  };
}

async function runB() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await resetServerLog();

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: 13,
        priority: 1,
        action: {
          type: "modifyHeaders",
          responseHeaders: [
            { header: "set-cookie", operation: "remove" },
            { header: "x-test", operation: "remove" }
          ]
        },
        condition: { tabIds: [tab.id], resourceTypes: ALL_TYPES }
      }]
    });
  } catch (error) {
    await closeTab(tab.id);
    return { error: error.message };
  }

  await chrome.tabs.update(tab.id, {
    url: TEST_ORIGIN + "/set-cookie?name=b&value=blocked"
  });
  await waitComplete(tab.id);
  await sleep(400);

  const cookie = await chrome.cookies.get({ url: TEST_ORIGIN + "/", name: "b" });
  const logs = await getLogs();
  const responseLogs = logs.filter(function (entry) {
    return entry.kind === "response" && entry.tabId === tab.id;
  });

  // Also test Set-Cookie on a subframe response, where tabIds rules should apply.
  await clearCookies();
  await chrome.tabs.update(tab.id, { url: TEST_ORIGIN + "/set-cookie-frame" });
  await waitComplete(tab.id);
  await sleep(500);
  const subCookie = await chrome.cookies.get({ url: TEST_ORIGIN + "/", name: "b2" });

  await closeTab(tab.id);
  return {
    cookieInJar: cookie ? cookie.value : null,
    subresourceCookieInJar: subCookie ? subCookie.value : null,
    setCookieSeenByWebRequest: responseLogs.flatMap(function (entry) {
      return entry.setCookie || [];
    }),
    xTestSeenByWebRequest: responseLogs.flatMap(function (entry) {
      return entry.xTest || [];
    })
  };
}

async function runC() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await resetServerLog();

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 11,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "cookie", operation: "remove" }]
          },
          condition: {
            tabIds: [tab.id],
            urlFilter: "|" + TEST_ORIGIN + "/",
            resourceTypes: ALL_TYPES
          }
        },
        {
          id: 12,
          priority: 2,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "cookie", operation: "set", value: "jar=hello" }]
          },
          condition: {
            tabIds: [tab.id],
            urlFilter: "|" + TEST_ORIGIN + "/",
            resourceTypes: ALL_TYPES
          }
        },
        {
          id: 14,
          priority: 3,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "x-duotab-test", operation: "set", value: "main" }]
          },
          condition: {
            tabIds: [tab.id],
            urlFilter: "|" + TEST_ORIGIN + "/",
            resourceTypes: ALL_TYPES
          }
        },
        {
          id: 15,
          priority: 4,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "x-no-tab", operation: "set", value: "yes" }]
          },
          condition: {
            urlFilter: "|" + TEST_ORIGIN + "/",
            resourceTypes: ALL_TYPES
          }
        }
      ]
    });
  } catch (error) {
    await closeTab(tab.id);
    return { error: error.message };
  }

  await chrome.tabs.update(tab.id, { url: TEST_ORIGIN + "/echo-page" });
  await waitComplete(tab.id);
  await sleep(1800);

  const serverLog = await getServerLog();
  await closeTab(tab.id);

  return {
    requests: serverLog.filter(function (entry) {
      return entry.url.indexOf("/echo") === 0 || entry.url.indexOf("/echo-page") === 0;
    })
  };
}

async function runD() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await chrome.storage.local.remove(PAGE_REPORT_KEY);

  const tab = await chrome.tabs.create({
    url: TEST_ORIGIN + "/cookie-page",
    active: false
  });
  await waitComplete(tab.id);
  await sleep(900);

  const stored = await chrome.storage.local.get(PAGE_REPORT_KEY);
  const realCookie = await chrome.cookies.get({
    url: TEST_ORIGIN + "/",
    name: "poc_page"
  });

  await closeTab(tab.id);
  return {
    report: stored[PAGE_REPORT_KEY] || null,
    realJarCookie: realCookie ? realCookie.value : null
  };
}

// Fallback idea: keep one cookie jar per session in extension storage and swap
// chrome.cookies before each navigation. This test shows the shared-jar problem.
async function runE() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await resetServerLog();

  async function setJar(value) {
    await chrome.cookies.set({
      url: TEST_ORIGIN + "/",
      name: "sess",
      value: value,
      path: "/"
    });
  }

  await setJar("A");
  const first = await chrome.tabs.create({ url: TEST_ORIGIN + "/plain", active: false });
  await waitComplete(first.id);
  await sleep(300);

  // Change the jar while the first tab is still open, then reload it.
  await setJar("B");
  await chrome.tabs.reload(first.id);
  await waitComplete(first.id);
  await sleep(300);

  // A second tab opened now shares the same jar as the first tab.
  const second = await chrome.tabs.create({ url: TEST_ORIGIN + "/plain", active: false });
  await waitComplete(second.id);
  await sleep(300);

  const serverLog = await getServerLog();
  await closeTab(first.id);
  await closeTab(second.id);

  const firstTabRequests = serverLog.filter(function (entry) {
    return entry.url.indexOf("/echo?kind=plain") === 0;
  });

  return {
    cookieSeenByServer: firstTabRequests.map(function (entry) { return entry.cookie; })
  };
}

// Hybrid test: block Set-Cookie, keep the jar in memory, and inject it with DNR.
// It measures whether a cookie set by one response is ready for the next request.
async function runF() {
  await clearRules();
  await clearCookies();
  await clearLogs();
  await resetServerLog();
  await chrome.storage.local.set({ [HYBRID_KEY]: null });

  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const baseRule = {
    id: 12,
    priority: 2,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "cookie", operation: "set", value: "boot=1" }]
    },
    condition: {
      tabIds: [tab.id],
      urlFilter: "|" + TEST_ORIGIN + "/",
      resourceTypes: ALL_TYPES
    }
  };

  hybridTabId = tab.id;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [
        {
          id: 13,
          priority: 1,
          action: {
            type: "modifyHeaders",
            responseHeaders: [{ header: "set-cookie", operation: "remove" }]
          },
          condition: { tabIds: [tab.id], resourceTypes: ALL_TYPES }
        },
        baseRule
      ]
    });
  } catch (error) {
    hybridTabId = null;
    await closeTab(tab.id);
    return { error: error.message };
  }

  await chrome.tabs.update(tab.id, { url: TEST_ORIGIN + "/timing" });
  await waitComplete(tab.id);
  await sleep(1600);

  const stored = await chrome.storage.local.get(HYBRID_KEY);
  const serverLog = await getServerLog();
  hybridTabId = null;
  await closeTab(tab.id);

  const immediate = serverLog.find(function (entry) {
    return entry.url === "/echo?kind=immediate";
  });
  const delayed = serverLog.find(function (entry) {
    return entry.url === "/echo?kind=delayed";
  });

  return {
    cookie: stored[HYBRID_KEY] || null,
    immediateCookie: immediate ? immediate.cookie : null,
    delayedCookie: delayed ? delayed.cookie : null
  };
}

async function runAll() {
  const results = {
    a: await runA(),
    b: await runB(),
    c: await runC(),
    d: await runD(),
    e: await runE(),
    f: await runF(),
    at: Date.now()
  };
  await chrome.storage.local.set({ [RESULTS_KEY]: results });
  return results;
}

// Log request Cookie headers and response Set-Cookie headers for the test origin.
chrome.webRequest.onBeforeSendHeaders.addListener(
  function (details) {
    if (!details.url.startsWith(TEST_ORIGIN)) return;
    const cookieHeader = (details.requestHeaders || []).find(function (header) {
      return header.name.toLowerCase() === "cookie";
    });
    addLog({
      kind: "request",
      time: Date.now(),
      tabId: details.tabId,
      url: details.url,
      cookie: cookieHeader ? cookieHeader.value : ""
    });
  },
  { urls: [TEST_ORIGIN + "/*"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (!details.url.startsWith(TEST_ORIGIN)) return;
    const setCookie = (details.responseHeaders || [])
      .filter(function (header) {
        return header.name.toLowerCase() === "set-cookie";
      })
      .map(function (header) { return header.value; });
    const xTest = (details.responseHeaders || [])
      .filter(function (header) {
        return header.name.toLowerCase() === "x-test";
      })
      .map(function (header) { return header.value; });
    addLog({
      kind: "response",
      time: Date.now(),
      tabId: details.tabId,
      url: details.url,
      setCookie: setCookie,
      xTest: xTest
    });

    // Test f: harvest Set-Cookie for this tab and inject it into the DNR rule.
    if (hybridTabId !== null && details.tabId === hybridTabId && setCookie.length) {
      const first = setCookie[0];
      const pair = first.split(";")[0];
      const name = pair.slice(0, pair.indexOf("=")).trim();
      if (name === "login") {
        const started = Date.now();
        chrome.storage.local.set({
          [HYBRID_KEY]: { pair: pair, at: started, ruleUpdate: null }
        }).catch(function () {});
        chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [12],
          addRules: [{
            id: 12,
            priority: 2,
            action: {
              type: "modifyHeaders",
              requestHeaders: [{ header: "cookie", operation: "set", value: pair }]
            },
            condition: {
              tabIds: [hybridTabId],
              urlFilter: "|" + TEST_ORIGIN + "/",
              resourceTypes: ALL_TYPES
            }
          }]
        }).then(function () {
          return chrome.storage.local.get(HYBRID_KEY);
        }).then(function (result) {
          const jar = result[HYBRID_KEY];
          if (jar) {
            jar.ruleUpdate = Date.now() - started;
            return chrome.storage.local.set({ [HYBRID_KEY]: jar });
          }
          return null;
        }).catch(function (error) {
          console.error("DuoTab PoC: rule update failed.", error);
        });
      }
    }
  },
  { urls: [TEST_ORIGIN + "/*"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== "string") return false;

  if (message.type === "poc-page-report") {
    chrome.storage.local.set({
      [PAGE_REPORT_KEY]: {
        report: message.report,
        url: sender.tab ? sender.tab.url : "",
        tabId: sender.tab ? sender.tab.id : null
      }
    }).then(function () {
      sendResponse({ ok: true });
    }).catch(function () {
      sendResponse({ ok: false });
    });
    return true;
  }

  const jobs = {
    "run-a": runA,
    "run-b": runB,
    "run-c": runC,
    "run-d": runD,
    "run-e": runE,
    "run-f": runF,
    "run-all": runAll,
    "get-results": async function () {
      const result = await chrome.storage.local.get(RESULTS_KEY);
      return result[RESULTS_KEY] || null;
    }
  };

  const job = jobs[message.type];
  if (!job) {
    sendResponse({ ok: false, error: "Unknown PoC action." });
    return false;
  }

  Promise.resolve()
    .then(job)
    .then(function (result) { sendResponse({ ok: true, result: result }); })
    .catch(function (error) {
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});
