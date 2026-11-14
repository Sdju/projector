import { afterEach, expect, test, vi } from "vite-plus/test";

afterEach(() => vi.unstubAllGlobals());

test("Hub device notifications are muted per browser origin and survive a reload", async () => {
  vi.resetModules();
  vi.stubGlobal("location", { origin: "https://hub.example" });
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  });
  const notifications = await import("../modules/hub/notifications.ts");
  expect(notifications.hubNotifyEnabled("laptop")).toBe(true);
  notifications.setHubNotifyEnabled("laptop", false);
  expect(notifications.hubNotifyEnabled("laptop")).toBe(false);
  expect(JSON.parse(store.get("projector:hub-notify:https://hub.example"))).toEqual(["laptop"]);

  vi.resetModules();
  const reloaded = await import("../modules/hub/notifications.ts");
  expect(reloaded.hubNotifyEnabled("laptop")).toBe(false);
  expect(reloaded.hubNotifyEnabled("desk")).toBe(true);
});
