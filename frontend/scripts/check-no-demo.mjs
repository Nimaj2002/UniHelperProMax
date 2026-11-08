// 024: fail if the normal build (dist/) contains any demo-mode code (spec FR-013, SC-005).
// The desktop app and Docker image ship dist/, so this also guards them.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "..", "dist");
const MARKERS = ["UNIHELPER_DEMO_BUILD", "mockServiceWorker"];

if (!existsSync(dist)) {
  console.error("check-no-demo: dist/ not found; run the normal build first");
  process.exit(1);
}

const bad = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (name === "mockServiceWorker.js" || MARKERS.some((m) => readFileSync(file).includes(m))) bad.push(path.relative(dist, file));
  }
};
walk(dist);

if (bad.length) {
  console.error(`check-no-demo: demo code found in dist/:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
console.log("dist/ is demo-free");
