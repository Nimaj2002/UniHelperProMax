// T033: window storage (IndexedDB, localStorage) survives a restart on the same port (FR-016).
import { expect, test } from "@playwright/test";
import { appWindow, launchApp, newProfile, quit } from "./helpers";

test("IndexedDB and localStorage survive quit and relaunch", async () => {
  const profile = await newProfile();
  let app = await launchApp(profile);
  let page = await appWindow(app, profile);
  await page.evaluate(async () => {
    localStorage.setItem("uh.e2e.marker", "kept");
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("uh-e2e", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("s");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction("s", "readwrite");
        tx.objectStore("s").put("kept", "marker");
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
  });
  await quit(app);

  app = await launchApp(profile);
  page = await appWindow(app, profile);
  const values = await page.evaluate(async () => ({
    local: localStorage.getItem("uh.e2e.marker"),
    idb: await new Promise((resolve) => {
      const open = indexedDB.open("uh-e2e", 1);
      open.onsuccess = () => {
        const req = open.result.transaction("s").objectStore("s").get("marker");
        req.onsuccess = () => resolve(req.result);
      };
    }),
    persisted: await navigator.storage.persisted(),
  }));
  expect(values.local).toBe("kept");
  expect(values.idb).toBe("kept");
  test.info().annotations.push({ type: "storage.persisted", description: String(values.persisted) });
  await quit(app);
});
