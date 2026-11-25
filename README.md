# DuoTab

DuoTab is a small browser extension for saving the tabs in your current window as a named session. Sessions are kept in local browser storage, and you can reopen any of them later in a new window.

It uses Manifest V3 and plain HTML, CSS, and JavaScript. There are no frameworks, build steps, external libraries, CDNs, or analytics.

## Features

- Save all web tabs in the current window under a custom name.
  - If the name is empty, DuoTab uses `Session <date and time>`.
  - Only `http://` and `https://` tabs are saved. Browser pages such as `chrome://`, `edge://`, and `brave://` are skipped.
  - Each saved tab keeps its title, URL, and favicon URL.
- View saved sessions with their name, tab count, and saved date.
- Open a session in a new window with all of its tabs.
- Rename a session.
- Delete a session after a confirmation prompt.
- Search sessions by name.
- Click a session to expand its tab list.
- Click a tab title in the list to open just that tab.
- Remove a single tab from a saved session.
- Add the current tab to an expanded session.
- Export all sessions to a JSON file and import sessions from a JSON file.
- Dark and light themes. DuoTab follows your browser theme first, then remembers the theme you choose.
- Friendly empty states and small error or success messages.

## Install with "Load unpacked"

### Google Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `duotab` folder. It must be the folder that contains `manifest.json`.
5. Optional: click the puzzle-piece icon in the toolbar and pin **DuoTab**.

### Microsoft Edge

1. Open `edge://extensions`.
2. Turn on **Developer mode** in the left sidebar.
3. Click **Load unpacked**.
4. Select the `duotab` folder that contains `manifest.json`.
5. Optional: pin DuoTab from the extensions menu.

### Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the `duotab` folder that contains `manifest.json`.
5. Optional: pin DuoTab from the extensions menu.

After loading, click the DuoTab icon in the toolbar to open the popup.

## How to use

1. Open the tabs you want to keep, then click the DuoTab icon.
2. Optionally type a name and click **Save**. Leave the name blank to use the automatic date-and-time name.
3. Click a session header to expand it and see its tabs.
4. Click **Open** to open all tabs in that session in a new window.
5. Use **Rename** or **Delete** as needed.
6. Use the search box to filter sessions by name.
7. Click a tab title to open that tab. Use the `×` button to remove it from the session.
8. With a session expanded, click **+ Add current tab** to add the active tab.
9. Use **Export JSON** to download a backup of every session.
10. Use **Import JSON** to add sessions from a DuoTab export. Imported sessions are added to the existing list; valid imported sessions get new IDs, and invalid entries are skipped.
11. Click the sun or moon icon in the header to switch themes. Your choice is stored for next time.

## Permissions

DuoTab requests these permissions, and only these:

- **`tabs`** - create, focus, and close session tabs, and read tab URLs/titles for session tracking.
- **`storage`** - save sessions, the tab-to-session map, default URL, theme, and experimental cookie jars locally with `chrome.storage.local` / `chrome.storage.session`.
- **`webRequest`** - observe `Set-Cookie` response headers on session tabs so each session's cookie jar can be built (experimental routing only).
- **`declarativeNetRequest`** - block `Set-Cookie` from entering the real browser jar and inject the session's `Cookie` header on outgoing requests, scoped to session tab IDs (experimental routing only).
- **`host_permissions: ["<all_urls>"]`** - needed so `webRequest` and declarativeNetRequest can work on any website opened in a session tab.

DuoTab intentionally does **not** request the `cookies` or `scripting` permissions: cookie jars are managed in extension storage, and the page-side helper is declared as a content script in the manifest.

There are no analytics. DuoTab does not send your session data anywhere; everything stays on this device. When you expand a session, the browser may load saved favicon images from their original websites, just like a normal tab does.

**Back up before uninstalling:** removing an extension can delete its local storage. Export your sessions first if you want to keep them.

## Experimental per-tab login routing (Phase 2)

DuoTab includes an **experimental** per-tab login-routing feature, off by default. Turn it on in the popup under "Experimental: per-tab login routing".

How it works:

- Each session keeps its own cookie jar in local browser storage (`chrome.storage.local`), keyed by session.
- `webRequest` observes `Set-Cookie` on responses to session tabs and saves cookies into that session's jar (domain, path, Secure, HttpOnly, expiry basics respected).
- Declarative Net Request rules, scoped to the tab IDs of session tabs, remove the real `Cookie` header (so real cookies never leak), remove incoming `Set-Cookie` (so the real browser jar is not polluted), and inject the session's `Cookie` header on outgoing requests.
- A content script (MAIN world, `document_start`, all frames) overrides `document.cookie` to read/write the session jar for that tab and prefixes `localStorage`/`sessionStorage` keys per session.

Important limits (read before enabling):

- This is **not full browser isolation**. It only rewrites cookie headers and overrides page-side document.cookie/storage.
- **Service workers** do not reliably receive injected cookies.
- **IndexedDB, Cache Storage, localStorage tokens, and other origin storage** are only key-prefixed at the page-script level; they are not truly partitioned.
- **HttpOnly cookie semantics** cannot be faithfully emulated in page JavaScript.
- OAuth/SSO flows, WebSockets, partitioned cookies, and sites with fraud/bot detection may break or leak.
- Normal (non-session) tabs are never affected: rules are scoped to session tab IDs.

Privacy: cookie jars never leave your device. Export/import backs up session metadata (names, URLs, tab counts), not cookie jars. Back up before uninstalling.


Sessions are stored under the `sessions` key in `chrome.storage.local`. The exported file has this shape:

```json
{
  "sessions": [
    {
      "id": "s1700000000000",
      "name": "Study",
      "createdAt": 1700000000000,
      "tabs": [
        {
          "title": "MDN",
          "url": "https://developer.mozilla.org",
          "favicon": ""
        }
      ]
    }
  ]
}
```

Imported files may use this object shape or a plain array of sessions. Only sessions with at least one valid `http://` or `https://` tab are imported.

## Create a zip for store upload

The store requires `manifest.json` at the **root** of the zip, not inside an extra `duotab` folder.

### Windows (PowerShell)

From the folder that contains `duotab`, run:

```powershell
Compress-Archive -Path .\duotab\* -DestinationPath .\duotab.zip -Force
```

### Windows (File Explorer)

1. Open the `duotab` folder.
2. Select `manifest.json`, `popup.html`, `popup.js`, `style.css`, `README.md`, and the `icons` folder.
3. Right-click the selection and choose **Compress to ZIP file**.
4. Name the archive `duotab.zip`.

Do not zip the parent folder itself, or the manifest will be one level too deep.

### macOS / Linux

```bash
cd duotab
zip -r ../duotab.zip . -x "*.DS_Store"
```

To check the archive, open it or run `unzip -l duotab.zip`. You should see `manifest.json` at the top level, not `duotab/manifest.json`.

## Icons

The included icons in `icons/` are simple generated placeholders:

- `icons/icon16.png` - 16 × 16 px
- `icons/icon48.png` - 48 × 48 px
- `icons/icon128.png` - 128 × 128 px

To replace them, use any image editor and export PNG files with the same names and sizes. Transparent corners work well. The manifest already points to these filenames, so no code changes are needed.

## Files

```text
duotab/
├── manifest.json
├── popup.html
├── popup.js
├── style.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Manual test checklist

### Phase 1: session tabs

- [ ] Load unpacked `duotab/` in Edge/Chrome/Brave (developer mode → Load unpacked → select the `duotab` folder).
- [ ] Popup opens; "Live sessions" and "Saved windows" views switch.
- [ ] On a normal tab, the pill shows "This tab: not in a session" and the extension has no badge.
- [ ] Set a default page URL, click **+ New session tab**: a tab opens, a "Session 1" card with a colored numbered circle appears, and the badge shows `1` in the session color.
- [ ] Click `+` on a session card: another tab opens in the same session; tab count updates.
- [ ] Enter `3` in **Create many** → **Create**: 3 sessions with distinct numbers/colors appear.
- [ ] Click **Go**: the session's tab is focused.
- [ ] From a session tab, open a link in a new tab (context menu / `target="_blank`): the new tab joins the same session (badge + tab count update).
- [ ] Close all tabs of a session: it moves to "Reopen closed sessions" with saved URLs; **Reopen** restores them.
- [ ] Click **Delete**: `confirm()` appears; confirming closes its tabs and removes it; cancelling keeps it.
- [ ] **Export JSON** downloads a valid file; **Import JSON** adds sessions and skips invalid entries.
- [ ] Reload the popup: live sessions remain. Restart the browser: stale tab IDs are cleaned; closed sessions remain reopenable (note: `storage.session` is cleared on restart, so tabs are re-associated via reopen).
- [ ] Normal tabs opened independently have no DuoTab badge and are not listed in sessions.

### Phase 2: experimental cookie routing (off by default)

- [ ] Enable "Experimental: per-tab login routing" in the popup; a warning about limits is shown.
- [ ] Open the same login page in Session 1 and Session 2; log in with two different accounts.
- [ ] Reload both tabs: each tab keeps its own account; the real browser cookie jar (`chrome://settings/cookies`) shows no DuoTab session cookies.
- [ ] Close and reopen the browser: jars persist in local storage; re-enable experimental routing if needed and confirm accounts stay separate.
- [ ] Log in with a third account in a normal (non-session) tab: it is unaffected by session routing.
- [ ] Disable experimental routing: rules are removed; session tabs keep working as plain tabs.

## Quick troubleshooting

- **The extension does not appear:** make sure you selected the `duotab` folder itself and that `manifest.json` is directly inside it.
- **A session will not open:** the browser may be unable to open a saved address. Try opening the tab individually to check the URL.
- **Imported sessions are missing:** the file must contain a `sessions` array (or be an array) with at least one valid `http` or `https` tab per session.
