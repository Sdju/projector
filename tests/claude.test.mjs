import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOs, os } from "../core/modules/os/index.ts";
import {
  readClaudeUsage,
  retryAfterMs,
} from "../server/modules/agents-integration/claude/client.ts";
import { claudeWindows, claudeUsage } from "../server/modules/agents-integration/claude/usage.ts";
import { handleClaude } from "../server/routes/api/claude.ts";

const window = { utilization: 29, resets_at: "2026-10-11T19:00:00.220419+00:00" };
const payload = { five_hour: window, seven_day: { ...window, utilization: 4 }, account: "SECRET" };

test("Claude normalizes real OAuth windows, optional windows and exhaustion", () => {
  const windows = claudeWindows(payload);
  expect(windows.rolling.usedPercent).toBe(29);
  expect(windows.weekly.usedPercent).toBe(4);
  expect(windows.weekly.resetsAt).toBe(Math.floor(Date.parse(window.resets_at) / 1000));
  expect(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.usedPercent).toBe(
    100,
  );
  expect(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.limited).toBe(true);
  expect(claudeWindows({ five_hour: window }).weekly).toBe(null);
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

test("Retry-After accepts seconds and HTTP dates, rejects immediate and invalid retries", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  expect(retryAfterMs("60", now)).toBe(60000);
  expect(retryAfterMs("Mon, 05 Oct 2026 10:01:00 GMT", now)).toBe(60000);
  for (const value of [null, "", " ", "0", "-1", "NaN", "garbage", "Mon, 05 Oct 2026 09:00:00 GMT"])
    expect(retryAfterMs(value, now)).toBe(null);
});

describe("Claude auth and HTTP cache protect credentials and respect throttling", () => {
  let directory, previousDir, previousFetch, realNow, state, now, calls, path, auth, reset;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-claude-"));
    previousDir = process.env.CLAUDE_CONFIG_DIR;
    previousFetch = globalThis.fetch;
    realNow = Date.now;
    state = globalThis.projectorClaudeUsage;
    now = realNow();
    calls = 0;
    Date.now = () => now;
    process.env.CLAUDE_CONFIG_DIR = directory;
    path = join(directory, ".credentials.json");
    auth = JSON.stringify({
      claudeAiOauth: { accessToken: "fixture", refreshToken: "SECRET" },
    });
    reset = () => {
      state.value = undefined;
      state.throttles = 0;
    };
  });
  afterAll(async () => {
    Date.now = realNow;
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    reset();
    await rm(directory, { recursive: true, force: true });
  });

  test("Linux and Windows read only the selected config directory", async () => {
    await expect(os.tools.readClaudeAccessToken()).rejects.toThrow(/Авторизация/);
    await writeFile(path, "SECRET invalid JSON");
    await expect(os.tools.readClaudeAccessToken()).rejects.toSatisfy(
      (error) => !error.message.includes("SECRET"),
    );
    await writeFile(path, JSON.stringify({ accessToken: "not-oauth" }));
    await expect(os.tools.readClaudeAccessToken()).rejects.toThrow(/OAuth/);
    await writeFile(path, auth);
    for (const platform of ["linux", "win32"])
      expect(await createOs(platform).tools.readClaudeAccessToken()).toBe("fixture");
  });
  test("concurrent tabs and HTTP route share five-minute cache without exposing auth", async () => {
    reset();
    globalThis.fetch = async (url, options) => {
      calls++;
      expect(url).toBe("https://api.anthropic.com/api/oauth/usage");
      expect(options.headers.Authorization).toBe("Bearer fixture");
      expect(options.headers["anthropic-beta"]).toBe("oauth-2025-04-20");
      expect(options.redirect).toBe("error");
      expect(options.signal instanceof AbortSignal).toBeTruthy();
      return Response.json(payload);
    };
    const [a, b] = await Promise.all([claudeUsage(), claudeUsage()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(a.nextCheckAt - a.checkedAt).toBe(300000);
    expect(await claudeUsage()).toBe(a);
    let body;
    const headers = {};
    const res = {
      setHeader: (key, value) => {
        headers[key] = value;
      },
      end: (value) => {
        body = value;
      },
    };
    expect(await handleClaude({ res, method: "GET", path: "/api/claude/usage" })).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(body).not.toMatch(/SECRET|fixture|Authorization/);
    expect(calls).toBe(1);
    expect(await handleClaude({ res, method: "POST", path: "/api/claude/usage" })).toBe(false);
    now += 300001;
    await claudeUsage();
    expect(calls).toBe(2);
  });
  test("429 with zero Retry-After backs off 5/10/20/30 minutes across all callers", async () => {
    reset();
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("SECRET", { status: 429, headers: { "Retry-After": "0" } });
    };
    for (const minutes of [5, 10, 20, 30, 30]) {
      const before = calls;
      const [a, b] = await Promise.all([claudeUsage(), claudeUsage()]);
      expect(a).toBe(b);
      expect(a.status).toBe("unavailable");
      expect(a.windows).toBe(null);
      expect(a.nextCheckAt - now).toBe(minutes * 60000);
      expect(a.message).not.toMatch(/SECRET/);
      now = a.nextCheckAt - 1;
      expect(await claudeUsage()).toBe(a);
      expect(calls).toBe(before + 1);
      now += 1;
    }
    globalThis.fetch = async () => Response.json(payload);
    expect((await claudeUsage()).status).toBe("ready");
    expect(state.throttles).toBe(0);
  });
  test("Retry-After longer than fallback is respected", async () => {
    reset();
    globalThis.fetch = async () =>
      new Response("SECRET", { status: 429, headers: { "Retry-After": "3600" } });
    expect((await claudeUsage()).nextCheckAt - now).toBe(3600000);
  });
  test("expired auth and malformed responses are safe; file stays unchanged", async () => {
    for (const status of [401, 403, 500]) {
      reset();
      globalThis.fetch = async () => new Response("SECRET", { status });
      const result = await claudeUsage();
      expect(result.status).toBe("unavailable");
      expect(result.message).not.toMatch(/SECRET/);
      if (status === 401) expect(result.message).toMatch(/истекла/);
    }
    globalThis.fetch = async () => new Response("SECRET invalid JSON");
    await expect(readClaudeUsage()).rejects.toThrow(/Некорректный ответ/);
    expect(await readFile(path, "utf8")).toBe(auth);
  });
  test("timeout errors hide request credentials", async () => {
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET")), {
          once: true,
        });
      });
    const keepAlive = setInterval(() => {}, 100);
    try {
      await expect(readClaudeUsage(20)).rejects.toThrow(/Не удалось получить/);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
