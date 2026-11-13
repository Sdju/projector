import { beforeEach, describe, expect, test } from "vite-plus/test";

// The usage comes from Claude Code itself, through the Agent SDK: the fake query stands in for it.
const sdk = { usage: null, queries: [], closed: 0 };
const fakeSdk = {
  query: (request) => {
    sdk.queries.push(request);
    return {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: () => sdk.usage(),
      close: () => {
        sdk.closed++;
      },
    };
  },
};

const { ClaudeUsageError, readClaudeUsage } =
  await import("../../../plugins/claude-code/src/usage-client.ts");
const { claudeWindows, createClaudeUsageProvider } =
  await import("../../../plugins/claude-code/src/usage.ts");

const window = { utilization: 29, resets_at: "2026-10-11T19:00:00.220419+00:00" };
const rateLimits = { five_hour: window, seven_day: { ...window, utilization: 4 } };

beforeEach(() => {
  sdk.usage = async () => ({ rate_limits_available: true, rate_limits: rateLimits });
  sdk.queries.length = 0;
  sdk.closed = 0;
  globalThis.fetch = async () => {
    throw new Error("Projector must not call Anthropic HTTP APIs for usage");
  };
});

test("Claude normalizes the plan windows and keeps optional and exhausted ones right", () => {
  const windows = claudeWindows(rateLimits);
  expect(windows.rolling.usedPercent).toBe(29);
  expect(windows.weekly.usedPercent).toBe(4);
  expect(windows.weekly.resetsAt).toBe(Math.floor(Date.parse(window.resets_at) / 1000));
  expect(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.usedPercent).toBe(
    100,
  );
  expect(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.limited).toBe(true);
  expect(claudeWindows({ five_hour: window }).weekly).toBeUndefined();
  expect(claudeWindows({ seven_day: { ...window, resets_at: "bad" } }).weekly.resetsAt).toBe(null);
  for (const value of [
    null,
    {},
    [],
    { seven_day: { ...window, utilization: "4" } },
    { five_hour: { ...window, utilization: NaN } },
    { five_hour: { ...window, utilization: -1 } },
  ])
    expect(claudeWindows(value)).toBe(null);
});

describe("Claude usage comes from Claude Code, never from its credential file", () => {
  test("the query reports the plan limits without any token or HTTP request", async () => {
    expect(await readClaudeUsage(fakeSdk)).toEqual(rateLimits);
    expect(sdk.queries).toHaveLength(1);
    expect(sdk.queries[0].options).not.toHaveProperty("env");
    expect(JSON.stringify(sdk.queries[0].options)).not.toMatch(/token|credential|Bearer/i);
    expect(sdk.closed).toBe(1);
  });

  test("plans without limits (API key, cloud providers) report unavailable, not an error", async () => {
    sdk.usage = async () => ({ rate_limits_available: false, rate_limits: null });
    expect(await readClaudeUsage(fakeSdk)).toBe(null);
    expect((await createClaudeUsageProvider(fakeSdk).read(0)).status).toBe("unavailable");
  });

  test("failures and timeouts are reported without leaking details", async () => {
    sdk.usage = async () => {
      throw new Error("SECRET login detail");
    };
    const failure = await readClaudeUsage(fakeSdk).catch((error) => error);
    expect(failure).toBeInstanceOf(ClaudeUsageError);
    expect(failure.message).not.toMatch(/SECRET/);

    sdk.usage = () => new Promise(() => {});
    await expect(readClaudeUsage(fakeSdk, 20)).rejects.toBeInstanceOf(ClaudeUsageError);
    expect(sdk.closed).toBeGreaterThan(0);
  });

  test("one answer carries both windows and the check time", async () => {
    const provider = createClaudeUsageProvider(fakeSdk);
    expect(provider.kind).toBe("function");
    const value = await provider.read(123);
    expect(value).toMatchObject({
      status: "ready",
      checkedAt: 123,
      windows: { rolling: { usedPercent: 29 }, weekly: { usedPercent: 4 } },
    });
    expect(sdk.queries).toHaveLength(1);
  });
});
