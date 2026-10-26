// Prints the path of the e2e test build's executable (npm run build:e2e) on this system, for
// UNIHELPER_E2E_EXECUTABLE. Used by CI; handy locally too.
const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", "release-e2e");
const candidates = {
  win32: [path.join(out, "win-unpacked", "UniHelperProMax.exe")],
  linux: [path.join(out, "linux-unpacked", "unihelperpromax")],
  darwin: ["mac-arm64", "mac", "mac-universal"].map((d) =>
    path.join(out, d, "UniHelperProMax.app", "Contents", "MacOS", "UniHelperProMax"),
  ),
}[process.platform];
const found = (candidates ?? []).find((p) => fs.existsSync(p));
if (!found) {
  console.error(`no e2e build in ${out}; run "npm run build:e2e" first`);
  process.exit(1);
}
process.stdout.write(found);
