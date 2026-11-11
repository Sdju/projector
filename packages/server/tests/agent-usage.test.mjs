import { beforeEach, expect, onTestFinished, test } from "vite-plus/test";
import {
  agentUsageProvider,
  registerAgentBackend,
  unregisterAgentBackend,
} from "../modules/agent/index.ts";
import { readAgentUsageLimits, resetAgentUsageCache } from "../modules/agent-usage/index.ts";

registerAgentBackend(
  { id: "usage-default", label: "Default", run: async () => {} },
  {
    asDefault: true,
  },
);

function register(id, usage, run = async () => {}) {
  registerAgentBackend({ id, label: id, run, usage });
  onTestFinished(() => {
    try {
      unregisterAgentBackend(id);
    } catch {
      /* The registry may already be cleaned by the test. */
    }
  });
}

beforeEach(() => resetAgentUsageCache());

test("a command provider returns normalized windows", async () => {
  register("usage-ready", {
    kind: "command",
    command: process.execPath,
    args: [
      "-e",
      "process.stdout.write(JSON.stringify({status:'ready',checkedAt:123,windows:{weekly:{usedPercent:42,resetsAt:1700000000,limited:false}}}))",
    ],
    timeoutMs: 5000,
  });
  const value = await readAgentUsageLimits("usage-ready");
  expect(value).toMatchObject({
    status: "ready",
    checkedAt: 123,
    windows: { weekly: { usedPercent: 42, resetsAt: 1700000000, limited: false } },
  });
});

test("a missing provider and a failing command are explicit unavailable answers", async () => {
  register("usage-none", undefined);
  expect(await readAgentUsageLimits("usage-none")).toMatchObject({
    status: "unavailable",
    windows: null,
  });

  register("usage-fail", {
    kind: "command",
    command: process.execPath,
    args: ["-e", "process.stderr.write('no quota');process.exit(2)"],
    timeoutMs: 5000,
  });
  expect(await readAgentUsageLimits("usage-fail")).toMatchObject({
    status: "unavailable",
    windows: null,
    message: "no quota",
  });
});

test("a provider that never answers is stopped by the timeout", async () => {
  register("usage-slow", {
    kind: "command",
    command: process.execPath,
    args: ["-e", "setTimeout(() => {}, 10000)"],
    timeoutMs: 100,
  });
  const value = await readAgentUsageLimits("usage-slow");
  expect(value.status).toBe("unavailable");
  expect(value.message).toMatch(/вовремя/);
});

test("the registry exposes the provider and drops it with the agent", () => {
  register("usage-provider", { kind: "command", command: "example", args: ["usage"] });
  expect(agentUsageProvider("usage-provider")).toEqual({
    kind: "command",
    command: "example",
    args: ["usage"],
  });
  unregisterAgentBackend("usage-provider");
  expect(agentUsageProvider("usage-provider")).toBeUndefined();
});
