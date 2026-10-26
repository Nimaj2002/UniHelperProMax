// Copies the startup page's static files next to the compiled main process (tsc only emits .js),
// and the window icon (Windows and Linux show it in the title bar and taskbar).
const fs = require("node:fs");
const path = require("node:path");

const from = path.join(__dirname, "..", "src", "startup");
const to = path.join(__dirname, "..", "dist", "startup");
fs.mkdirSync(to, { recursive: true });
for (const name of fs.readdirSync(from)) {
  if (name.endsWith(".html") || name.endsWith(".css")) {
    fs.copyFileSync(path.join(from, name), path.join(to, name));
  }
}
fs.copyFileSync(
  path.join(__dirname, "..", "..", "icons", "png", "app-icon-512.png"),
  path.join(__dirname, "..", "dist", "icon.png"),
);
