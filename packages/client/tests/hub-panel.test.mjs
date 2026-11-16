import { expect, test } from "vite-plus/test";
import {
  hubActivityText,
  hubCountsText,
  hubDeviceCounts,
  hubDeviceItems,
  hubItemState,
  hubSourceId,
  sortHubDevices,
} from "../modules/workspace/lib/hub-panel.ts";

const devices = [
  { id: "old", name: "Old", protocol: 1, online: false },
  { id: "laptop", name: "Laptop", protocol: 1, online: true },
  { id: "desk", name: "Desk", protocol: 1, online: true },
];
const work = (sourceId, status, extra = {}) => ({
  key: `${sourceId}|job|${status}`,
  sourceId,
  category: status === "running" ? "working" : status === "done" ? "finished" : "attention",
  status,
  pending: [],
  projectName: "Projector",
  topic: "fix it",
  createdAt: 1,
  startedAt: 2,
  ...extra,
});

test("the Hub rail puts this device and online machines first", () => {
  expect(sortHubDevices(devices, "desk").map((device) => device.id)).toEqual([
    "desk",
    "laptop",
    "old",
  ]);
  expect(hubSourceId(devices[2], "desk", false)).toBe("");
  expect(hubSourceId(devices[1], "desk", false)).toBe("laptop");
  expect(hubSourceId(devices[2], "desk", true)).toBe("desk");
});

test("per-device counts and labels come from that device's work only", () => {
  const items = [
    work("desk", "needs-user", { pending: [{ id: "request", kind: "permission" }] }),
    work("laptop", "running", { startedAt: 3 }),
    work("laptop", "done", { endedAt: 4 }),
  ];
  const laptop = hubDeviceItems(items, devices[1], "desk", true);
  expect(laptop.map((item) => item.status)).toEqual(["running", "done"]);
  const counts = hubDeviceCounts(laptop);
  expect(counts).toMatchObject({ attention: 0, working: 1, unread: 1 });
  expect(hubCountsText(counts)).toBe("1 работает · 1 новый");
  expect(hubItemState(items[0])).toBe("ждёт ответа");
  expect(hubItemState(items[1])).toBe("работает");
  expect(hubActivityText(undefined)).toBe("");
  expect(hubActivityText(Date.UTC(2026, 0, 1, 12, 30))).toContain("активность в");
});
