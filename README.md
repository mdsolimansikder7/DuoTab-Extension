# DuoTab – Microsoft Edge Extension

**DuoTab** is a Microsoft Edge extension that helps you organize browser sessions and manage multiple tab sessions with separate login experiences.

Save your tab sessions, reopen saved windows, and manage multiple browsing sessions from one simple interface.

## ✨ Features

- **Live Sessions** – Manage multiple active tab sessions.
- **Separate Login Experience** – Give each session tab its own login experience.
- **Save Windows** – Save your current browser window and reopen it later.
- **Create New Sessions** – Create new session tabs easily.
- **Create Multiple Sessions** – Open multiple session tabs at once.
- **Reopen Closed Sessions** – Restore previously closed sessions.
- **Import & Export** – Backup and restore session data using JSON files.
- **Search Sessions** – Quickly find saved sessions.
- **Dark & Light Theme** – Switch between dark and light modes.
- **Local Storage** – Session management data is stored locally in your browser.

## 🌐 Browser Support

DuoTab is specifically developed for:

- **Microsoft Edge (Chromium-based)**
- Manifest V3

> This extension is designed and tested for Microsoft Edge.

## 📸 Installation

Follow these steps to install DuoTab in Microsoft Edge:

1. Download or clone this repository.
2. Open Microsoft Edge.
3. Navigate to `edge://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the DuoTab project folder containing `manifest.json`.
7. Pin DuoTab to your browser toolbar.

You're ready to use DuoTab!

## 🚀 How to Use

1. Click the DuoTab icon in the Edge toolbar.
2. Create a new session tab.
3. Use the session tab for a separate login experience.
4. Save your current browser window for later.
5. Reopen saved windows whenever needed.
6. Use Import and Export to back up or restore session data.

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript
- Chrome Extension APIs (Chromium-based Edge APIs)
- Manifest V3
- Browser Storage API

## 📁 Project Structure

```text
DuoTab-Extension/
│
├── icons/
│   └── Extension icons
│
├── poc/
│   └── Proof of concept files
│
├── background.js
├── content.js
├── live.js
├── popup.html
├── popup.js
├── style.css
├── debug.html
├── manifest.json
└── README.md
```

## 🔒 Privacy & Data

- DuoTab stores its session management data locally in the browser.
- Session data can be exported as a JSON file.
- Exported JSON files do not include cookie jars.
- DuoTab does not provide a guarantee of complete browser-level isolation.

## ⚠️ Important Limitations

DuoTab provides a separate login experience, but it is not a replacement for fully isolated browser profiles.

Some websites or browser features may not work as expected:

- Some cookies may not be handled as expected.
- IndexedDB and Cache Storage are not fully isolated.
- Service workers may not receive injected cookies.
- HttpOnly cookie behavior cannot be perfectly replicated.
- OAuth, SSO, WebSockets, and some modern authentication systems may have compatibility issues.
- Some websites may detect unusual session behavior.

For complete isolation, use separate Microsoft Edge profiles.

## 👨‍💻 Development

DuoTab is built with vanilla HTML, CSS, and JavaScript.

No build tools or external dependencies are required.

To work on the project:

1. Clone the repository.
2. Open the project folder in VS Code.
3. Make your changes.
4. Visit `edge://extensions` in Microsoft Edge.
5. Click **Reload** on the DuoTab extension to test your changes.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1. Fork the repository.
2. Create a new branch.
3. Make your changes.
4. Commit and push your changes.
5. Open a Pull Request.

## 📄 License

No license has been specified yet. Please contact the repository owner before redistributing or reusing this project.

## 👤 Author

**Md. Soliman Sikder**

- GitHub: [@mdsolimansikder7](https://github.com/mdsolimansikder7)

---

<p align="center">
  Made with ❤️ for Microsoft Edge
</p>
