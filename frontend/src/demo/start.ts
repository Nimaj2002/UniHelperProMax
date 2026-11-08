/**
 * 024: boots the browser demo (research R1, R6, R7, R9, R14). Only reachable through the
 * `import.meta.env.MODE === "demo"` block in main.tsx, so normal builds never contain it.
 */
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { setupWorker } from "msw/browser";
import { clearAppCaches, DemoBanner } from "./DemoBanner";
import { handlers } from "./handlers";
import { createSeed } from "./seed";
import { resetStore } from "./store";
import embarrassedYuii from "./assets/embarrassed-yuii.webp";
import { demoUnavailable, DOWNLOAD_URL } from "./unavailable";

export const DEMO_MARKER = "UNIHELPER_DEMO_BUILD";

function unsupported(): never {
  const root = document.getElementById("root")!;
  root.innerHTML = `<main style="display:grid;place-items:center;min-height:100dvh;padding:1rem;text-align:center;font-family:system-ui">
    <div><h1 style="font-size:1.25rem;margin-bottom:.5rem">Open the demo in a normal browser window</h1>
    <p>This browser window can't run the demo (private windows sometimes can't).</p>
    <p><a href="${DOWNLOAD_URL}">Download UniHelperProMax</a></p></div></main>`;
  throw new Error("demo: Service Workers unavailable");
}

/** Phones (portrait, or landscape = short touch screen): the app is built for a PC for now.
 * Tablets and narrow desktop windows still get the demo. Same rule as the website. */
export const MOBILE_QUERY = "(max-width: 480px), (hover: none) and (pointer: coarse) and (max-height: 480px)";
const WEBSITE_URL = "https://www.unihelperpromax.tech/";

function pcOnly(): never {
  const root = document.getElementById("root")!;
  root.innerHTML = `<main style="display:grid;place-items:center;min-height:100dvh;padding:1rem;text-align:center;font-family:system-ui">
    <div style="max-width:28rem"><img src="${embarrassedYuii}" alt="Yuii scratching her head, embarrassed" width="615" height="640" style="display:block;width:auto;height:min(280px,38svh);margin:0 auto 1rem">
    <h1 style="font-size:1.25rem;margin-bottom:.5rem">UniHelperProMax is for PC only for now</h1>
    <p>Open this demo on a laptop or desktop computer to try it.</p>
    <p style="margin-top:1rem"><a href="${WEBSITE_URL}">Back to the website</a> · <a href="${DOWNLOAD_URL}">Download</a></p></div></main>`;
  throw new Error("demo: phone or touch-only device");
}

function mountBanner() {
  const host = document.createElement("div");
  host.id = "demo-banner";
  host.style.cssText = "position:fixed;inset:0 0 auto 0;z-index:40";
  document.body.prepend(host);
  createRoot(host).render(createElement(DemoBanner));
  // the shell already leaves room for a top bar through --titlebar-h (desktop title bar)
  const fit = () => document.documentElement.style.setProperty("--titlebar-h", `${host.offsetHeight}px`);
  new ResizeObserver(fit).observe(host);
  fit();
}

export async function startDemo(): Promise<void> {
  if (matchMedia(MOBILE_QUERY).matches) pcOnly();
  if (!("serviceWorker" in navigator)) unsupported();
  console.info(DEMO_MARKER);
  clearAppCaches();
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = () => {
      demoUnavailable("Recording");
      return Promise.reject(new DOMException("Recording is available in the UniHelperProMax app.", "NotAllowedError"));
    };
  }
  resetStore(createSeed(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone));
  try {
    await setupWorker(...handlers).start({
      onUnhandledRequest: "bypass",
      serviceWorker: { url: "/mockServiceWorker.js" },
      quiet: true,
    });
  } catch {
    unsupported();
  }
  mountBanner();
}
