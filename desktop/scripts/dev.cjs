// npm run dev: the desktop app with the backend run from source (backend/.venv) instead of the
// PyInstaller build. Uses its own profile in ../data-desktop-dev (ignored by git), so it never
// touches an installed app's data and can run next to it on another port.
//
// Backend changes: restart. Frontend changes: `pnpm --dir frontend build` (the window loads the
// built frontend from the backend); for UI work the web version with Vite is quicker.
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const desktop = path.join(__dirname, "..");
const root = path.join(desktop, "..");
const profile = process.env.UNIHELPER_DESKTOP_PROFILE || path.join(root, "data-desktop-dev");

function fail(message) {
  console.error(`dev: ${message}`);
  process.exit(1);
}

const python = path.join(root, "backend", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!fs.existsSync(python)) fail('no backend environment; run "uv sync" in backend/ first');
if (!fs.existsSync(path.join(root, "frontend", "dist", "index.html"))) {
  fail('no built frontend; run "pnpm --dir frontend install && pnpm --dir frontend build" first');
}

const build = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"], {
  cwd: desktop,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (build.status !== 0) process.exit(build.status ?? 1);

// a fixed dev port next to the installed app's default, so both can run at once
const settings = path.join(profile, "userData", "desktop.json");
if (!fs.existsSync(settings)) {
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ schemaVersion: 1, port: 47823 }, null, 2));
}

const electron = require("electron"); // the path of the Electron binary
const child = spawn(electron, [desktop, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, UNIHELPER_DESKTOP_DEV: "1", UNIHELPER_DESKTOP_PROFILE: profile },
});
child.on("exit", (code) => process.exit(code ?? 0));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
