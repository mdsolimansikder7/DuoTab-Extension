// DuoTab content script (MAIN world, document_start, all frames).
// Lets a session tab read/write its own cookie jar via document.cookie and
// prefixes localStorage/sessionStorage keys per session.

(function () {
  "use strict";

  let sessionId = null;
  let sessionNumber = null;
  let enabled = false;
  let jar = new Map(); // cookie name -> cookie object
  let originalTitle = "";
  let titleObserver = null;

  async function init() {
    const reply = await chrome.runtime
      .sendMessage({ type: "duotab-context" })
      .catch(function () {
        return null;
      });
    if (!reply) return;

    sessionId = reply.sessionId || null;
    sessionNumber = reply.sessionNumber || null;
    enabled = !!reply.enabled;
    if (!sessionId || !enabled) return;

    loadJar(reply.jar || { cookies: [] });
    installCookieOverride();
    installStorageOverride();
    initTitlePrefix();
  }

  function loadJar(jarObject) {
    jar = new Map();
    for (const cookie of jarObject.cookies || []) {
      if (cookie && cookie.name) {
        jar.set(cookie.name, cookie);
      }
    }
  }

  function initTitlePrefix() {
    if (!sessionNumber) return;
    const prefix = "[" + sessionNumber + "] ";
    
    // Set initial title
    if (document.title && !document.title.startsWith(prefix)) {
      originalTitle = document.title;
      document.title = prefix + originalTitle;
    }

    // Observe title changes
    titleObserver = new MutationObserver(function () {
      if (document.title && !document.title.startsWith(prefix)) {
        originalTitle = document.title;
        document.title = prefix + originalTitle;
      }
    });
    
    titleObserver.observe(document, { subtree: true, childList: true });
    
    // Also handle title changes via document.title setter
    const originalDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, "title");
    if (originalDescriptor && originalDescriptor.set) {
      const originalSet = originalDescriptor.set;
      Object.defineProperty(Document.prototype, "title", {
        configurable: true,
        get: originalDescriptor.get,
        set: function (value) {
          if (value && !String(value).startsWith(prefix)) {
            originalTitle = String(value);
            originalSet.call(this, prefix + originalTitle);
          } else {
            originalSet.call(this, value);
          }
        }
      });
    }
  }

  function matchesUrl(cookie) {
    if (!cookie) return false;
    try {
      const url = new URL(document.URL);
      const domain = (cookie.domain || "").replace(/^\./, "");
      const host = url.hostname;
      if (host !== domain && !host.endsWith("." + domain)) return false;
      const path = cookie.path || "/";
      if (!url.pathname.startsWith(path)) return false;
      if (cookie.secure && url.protocol !== "https:") return false;
      if (cookie.expires && Date.now() >= cookie.expires) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  function cookieString() {
    const values = [];
    for (const cookie of jar.values()) {
      if (matchesUrl(cookie)) {
        values.push(cookie.name + "=" + cookie.value);
      }
    }
    return values.join("; ");
  }

  function installCookieOverride() {
    const descriptor = {
      configurable: true,
      get: function () {
        return cookieString();
      },
      set: function (value) {
        handleSetCookie(String(value));
      }
    };
    try {
      Object.defineProperty(Document.prototype, "cookie", descriptor);
    } catch (error) {
      // The page may run in an isolated context where this is not allowed.
    }
  }

  function parseOneCookie(value) {
    const parts = String(value)
      .split(";")
      .map(function (part) {
        return part.trim();
      })
      .filter(Boolean);
    const first = parts[0] || "";
    const equals = first.indexOf("=");
    const name = equals < 0 ? first : first.slice(0, equals).trim();
    const cookieValue = equals < 0 ? "" : first.slice(equals + 1).trim();
    const cookie = {
      name: name,
      value: cookieValue,
      domain: "",
      path: "/",
      secure: false,
      httpOnly: false,
      expires: null
    };
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const eq = part.indexOf("=");
      const key = eq < 0 ? part : part.slice(0, eq);
      const val = eq < 0 ? "" : part.slice(eq + 1);
      switch (key.toLowerCase()) {
        case "domain":
          cookie.domain = val;
          break;
        case "path":
          cookie.path = val;
          break;
        case "secure":
          cookie.secure = true;
          break;
        case "expires": {
          const time = Date.parse(val);
          if (Number.isFinite(time)) cookie.expires = time;
          break;
        }
      }
    }
    return cookie;
  }

  async function handleSetCookie(value) {
    const cookie = parseOneCookie(value);
    if (!cookie.name) return;
    jar.set(cookie.name, cookie);
    try {
      await chrome.runtime.sendMessage({
        type: "duotab-jar-update",
        sessionId: sessionId,
        cookie: cookie
      });
    } catch (error) {
      // The background worker may be asleep; the cookie is kept locally.
    }
  }

  function prefixKey(key) {
    return "duotab:" + sessionId + ":" + key;
  }

  function installStorageOverride() {
    const proto = Storage.prototype;
    const rawGet = proto.getItem;
    const rawSet = proto.setItem;
    const rawRemove = proto.removeItem;

    proto.getItem = function (key) {
      return rawGet.call(this, prefixKey(key));
    };
    proto.setItem = function (key, value) {
      return rawSet.call(this, prefixKey(key), value);
    };
    proto.removeItem = function (key) {
      return rawRemove.call(this, prefixKey(key));
    };
  }

  init();
})();
