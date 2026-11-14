import { afterEach, expect, test, vi } from "vite-plus/test";
import { effectScope } from "vue";
import { useAgentInbox } from "../modules/agent/modules/jobs/model/inbox.ts";

const job = (extra = {}) => ({
  id: "aaaaaaaaaaaa",
  backend: "codex",
  task: "fix it",
  projectId: "p1",
  cwd: "/work",
  unattended: false,
  status: "needs-user",
  rev: 1,
  createdAt: 1,
  files: [],
  pending: [{ id: "request", kind: "permission", title: "Write" }],
  ...extra,
});

const devices = (laptopOnline) => [
  { id: "desk", name: "Desk", protocol: 1, online: true },
  { id: "laptop", name: "Laptop", protocol: 1, online: laptopOnline },
];

afterEach(() => vi.unstubAllGlobals());

test("a Hub activity signal reads only that device, and the device list removes it", async () => {
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("https://hub.example/devices/desk/projects/demo"));

  let laptopJobs = [];
  const urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      urls.push(path);
      const body = (() => {
        if (path.endsWith("/api/hub/devices")) return { devices: devices(true) };
        if (path.endsWith("/projects"))
          return { projects: [{ id: "p1", name: "Work", path: "/w" }] };
        if (path.includes("/devices/laptop/agent/jobs")) return { jobs: laptopJobs };
        if (path.includes("/agent/runs")) return { runs: [] };
        return { jobs: [] };
      })();
      return { ok: true, json: async () => body };
    }),
  );

  const scope = effectScope();
  const inbox = scope.run(() => useAgentInbox());
  await vi.waitFor(() => expect(inbox.loading.value).toBe(false));
  expect(inbox.sources.value.map((source) => source.id)).toEqual(["desk", "laptop"]);
  expect(inbox.items.value).toEqual([]);

  laptopJobs = [job()];
  const before = urls.filter((url) => url.includes("/devices/laptop/agent/jobs")).length;
  page.dispatchEvent(new CustomEvent("projector:hub-activity", { detail: { deviceId: "laptop" } }));
  await vi.waitFor(() =>
    expect(inbox.items.value).toMatchObject([{ sourceId: "laptop", id: "aaaaaaaaaaaa" }]),
  );
  // Only the named device was read again, not every remote device.
  expect(urls.filter((url) => url.includes("/devices/laptop/agent/jobs"))).toHaveLength(before + 1);

  page.dispatchEvent(
    new CustomEvent("projector:hub-devices", { detail: { devices: devices(false) } }),
  );
  await vi.waitFor(() => expect(inbox.items.value).toEqual([]));
  expect(inbox.sources.value.map((source) => source.id)).toEqual(["desk"]);
  scope.stop();
});

test("a local page lists Hub devices but keeps reading only its own work", async () => {
  const page = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", document);
  vi.stubGlobal("location", new URL("http://localhost:4177/settings"));
  const urls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = String(url);
      urls.push(path);
      const body = (() => {
        if (path.endsWith("/api/hub/devices"))
          return {
            enabled: true,
            online: true,
            url: "https://hub.example",
            deviceId: "desk",
            devices: devices(true),
            activity: { laptop: 42 },
          };
        if (path.endsWith("/api/projects")) return { projects: [] };
        if (path.includes("/agent/runs")) return { runs: [], recent: [] };
        return { jobs: [] };
      })();
      return { ok: true, json: async () => body };
    }),
  );

  const scope = effectScope();
  const inbox = scope.run(() => useAgentInbox());
  await vi.waitFor(() => expect(inbox.loading.value).toBe(false));
  await inbox.refresh();
  expect(inbox.sources.value.map((source) => source.id)).toEqual([""]);
  expect(inbox.hub.value).toMatchObject({
    url: "https://hub.example",
    deviceId: "desk",
    activity: { laptop: 42 },
  });
  expect(inbox.hub.value.devices.map((device) => device.id)).toEqual(["desk", "laptop"]);
  page.dispatchEvent(
    new CustomEvent("projector:hub-activity", { detail: { deviceId: "laptop", at: 43 } }),
  );
  await vi.waitFor(() => expect(inbox.hub.value.activity.laptop).toBe(43));
  // The local server has no proxy to other machines: no remote request is made.
  expect(urls.some((url) => url.includes("/devices/laptop/agent/jobs"))).toBe(false);
  scope.stop();
});
