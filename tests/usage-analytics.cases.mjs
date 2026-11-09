import { expect, test } from "vite-plus/test";
import {
  expectedUsagePercent,
  limitPeriodSeconds,
  usagePaceTone,
} from "../packages/core/modules/usage-analytics/index.ts";
import { usageWindowsOf } from "../packages/server/modules/usage-analytics/index.ts";

test("usage windows follow both the named-windows and the single-weekly shapes", () => {
  const named = usageWindowsOf({
    status: "ready",
    checkedAt: 10,
    windows: {
      rolling: { usedPercent: 12.5, resetsAt: 100, limited: false },
      weekly: null,
      monthly: { usedPercent: 100, resetsAt: null },
    },
  });
  expect([...named.keys()]).toEqual(["rolling", "monthly"]);
  expect(named.get("rolling")).toEqual({ used: 12.5, resetsAt: 100, limited: false });
  expect(named.get("monthly")).toEqual({ used: 100, resetsAt: null, limited: true });

  const weekly = usageWindowsOf({
    status: "ready",
    checkedAt: 10,
    weekly: { usedPercent: 40, resetsAt: 200, limited: false },
  });
  expect(weekly.get("weekly")).toEqual({ used: 40, resetsAt: 200, limited: false });

  expect(
    usageWindowsOf({ status: "unavailable", windows: { rolling: { usedPercent: 5 } } }).size,
  ).toBe(0);
  expect(usageWindowsOf({ status: "ready", windows: { rolling: { usedPercent: -1 } } }).size).toBe(
    0,
  );
});

test("window names map to cycle lengths and the expected spent share", () => {
  expect(limitPeriodSeconds("rolling")).toBe(5 * 3600);
  expect(limitPeriodSeconds("weekly")).toBe(7 * 86400);
  expect(limitPeriodSeconds("monthly")).toBe(30 * 86400);
  expect(limitPeriodSeconds("total")).toBe(null);

  const now = 1_000_000;
  const period = 7 * 86400;
  const resetsAt = now / 1000 + period / 2;
  expect(expectedUsagePercent(period, resetsAt, now)).toBeCloseTo(50);
  expect(expectedUsagePercent(period, null, now)).toBe(null);
  expect(usagePaceTone(30, resetsAt, period, now)).toBe("spare");
  expect(usagePaceTone(70, resetsAt, period, now)).toBe("hot");
  expect(usagePaceTone(100, resetsAt, period, now)).toBe("over");
});
