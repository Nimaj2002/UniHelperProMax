// T032: the microphone is the only permission, and only for the app (FR-041).
import { expect, test } from "@playwright/test";
import { appWindow, fakeMicArgs, launchApp, newProfile, quit } from "./helpers";

test("microphone allowed; camera, location and notifications denied without a prompt @microphone", async () => {
  const profile = await newProfile();
  const app = await launchApp(profile, { args: fakeMicArgs() });
  const page = await appWindow(app, profile);
  const result = await page.evaluate(async () => {
    const attempt = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        return "allowed";
      } catch (e) {
        return (e as DOMException).name;
      }
    };
    return {
      audio: await attempt(async () => (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((t) => t.stop())),
      video: await attempt(() => navigator.mediaDevices.getUserMedia({ video: true })),
      geolocation: await new Promise((resolve) =>
        navigator.geolocation.getCurrentPosition(
          () => resolve("allowed"),
          (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : `error ${err.code}`),
          { timeout: 5000 },
        ),
      ),
      notifications: await Notification.requestPermission(),
    };
  });
  expect(result).toEqual({ audio: "allowed", video: "NotAllowedError", geolocation: "denied", notifications: "denied" });
  await quit(app);
});

test("UNIHELPER_E2E_DENY_MIC denies the microphone @microphone", async () => {
  const profile = await newProfile();
  const app = await launchApp(profile, { args: fakeMicArgs(), env: { UNIHELPER_E2E_DENY_MIC: "1" } });
  const page = await appWindow(app, profile);
  const name = await page.evaluate(async () => {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return "allowed";
    } catch (e) {
      return (e as DOMException).name;
    }
  });
  expect(name).toBe("NotAllowedError");
  await quit(app);
});
