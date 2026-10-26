// Ad-hoc signs the bundled backend (PyInstaller onedir) on macOS before electron-builder seals
// the app, so the hardened runtime loads it (research R15). A no-op on other platforms.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MACHO_MAGICS = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca"]);

function isMachO(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4);
    if (fs.readSync(fd, buf, 0, 4, 0) < 4) return false;
    return MACHO_MAGICS.has(buf.toString("hex"));
  } finally {
    fs.closeSync(fd);
  }
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && isMachO(full)) out.push(full);
  }
  return out;
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const backend = path.join(app, "Contents", "Resources", "backend");
  if (!fs.existsSync(backend)) throw new Error(`backend not found in ${backend}`);
  // innermost first: deeper paths sign before the executables that load them
  const files = walk(backend, []).sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const file of files) {
    execFileSync("codesign", ["--force", "--options", "runtime", "--timestamp=none", "-s", "-", file], {
      stdio: "inherit",
    });
  }
  console.log(`afterPack: ad-hoc signed ${files.length} backend Mach-O files`);
};
