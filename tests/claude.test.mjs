import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOs, os } from "../core/modules/os/index.ts";
import { readClaudeUsage, retryAfterMs } from "../server/modules/agents-integration/claude/client.ts";
import { claudeWindows, claudeUsage } from "../server/modules/agents-integration/claude/usage.ts";
import { handleClaude } from "../server/routes/api/claude.ts";

const window = { utilization: 29, resets_at: "2026-10-11T19:00:00.220419+00:00" };
const payload = { five_hour: window, seven_day: { ...window, utilization: 4 }, account: "SECRET" };

test("Claude normalizes real OAuth windows, optional windows and exhaustion", () => {
  const windows = claudeWindows(payload);
  assert.equal(windows.rolling.usedPercent, 29);
  assert.equal(windows.weekly.usedPercent, 4);
  assert.equal(windows.weekly.resetsAt, Math.floor(Date.parse(window.resets_at) / 1000));
  assert.equal(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.usedPercent, 100);
  assert.equal(claudeWindows({ five_hour: { ...window, utilization: 120 } }).rolling.limited, true);
  assert.equal(claudeWindows({ five_hour: window }).weekly, null);
  assert.equal(claudeWindows({ seven_day: { ...window, resets_at: "bad" } }).weekly.resetsAt, null);
  for (const value of [null, {}, [], { seven_day: { ...window, utilization: "4" } },
    { five_hour: { ...window, utilization: NaN } }, { five_hour: { ...window, utilization: -1 } }])
    assert.equal(claudeWindows(value), null);
});

test("Retry-After accepts seconds and HTTP dates, rejects immediate and invalid retries", () => {
  const now = Date.parse("2026-10-05T10:00:00Z");
  assert.equal(retryAfterMs("60", now), 60000);
  assert.equal(retryAfterMs("Mon, 05 Oct 2026 10:01:00 GMT", now), 60000);
  for (const value of [null, "", " ", "0", "-1", "NaN", "garbage", "Mon, 05 Oct 2026 09:00:00 GMT"])
    assert.equal(retryAfterMs(value, now), null);
});

test("Claude auth and HTTP cache protect credentials and respect throttling", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-claude-"));
  const previousDir = process.env.CLAUDE_CONFIG_DIR;
  const previousFetch = globalThis.fetch;
  const realNow = Date.now;
  const state = globalThis.projectorClaudeUsage;
  let now = realNow(), calls = 0;
  Date.now = () => now;
  process.env.CLAUDE_CONFIG_DIR = directory;
  const path = join(directory, ".credentials.json");
  const auth = JSON.stringify({ claudeAiOauth: { accessToken: "fixture", refreshToken: "SECRET" } });
  const reset = () => { state.value = undefined; state.throttles = 0; };
  try {
    await t.test("Linux and Windows read only the selected config directory", async () => {
      await assert.rejects(os.tools.readClaudeAccessToken(), /Авторизация/);
      await writeFile(path, "SECRET invalid JSON");
      await assert.rejects(os.tools.readClaudeAccessToken(), (error) => !error.message.includes("SECRET"));
      await writeFile(path, JSON.stringify({ accessToken: "not-oauth" }));
      await assert.rejects(os.tools.readClaudeAccessToken(), /OAuth/);
      await writeFile(path, auth);
      for (const platform of ["linux", "win32"])
        assert.equal(await createOs(platform).tools.readClaudeAccessToken(), "fixture");
    });
    await t.test("concurrent tabs and HTTP route share five-minute cache without exposing auth", async () => {
      reset();
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
        assert.equal(options.headers.Authorization, "Bearer fixture");
        assert.equal(options.headers["anthropic-beta"], "oauth-2025-04-20");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(payload);
      };
      const [a, b] = await Promise.all([claudeUsage(), claudeUsage()]);
      assert.equal(a, b);
      assert.equal(a.status, "ready");
      assert.equal(a.nextCheckAt - a.checkedAt, 300000);
      assert.equal(await claudeUsage(), a);
      let body;
      const headers = {};
      const res = { setHeader: (key, value) => { headers[key] = value; }, end: (value) => { body = value; } };
      assert.equal(await handleClaude({ res, method: "GET", path: "/api/claude/usage" }), true);
      assert.equal(res.statusCode, 200);
      assert.equal(headers["Cache-Control"], "no-store");
      assert.doesNotMatch(body, /SECRET|fixture|Authorization/);
      assert.equal(calls, 1);
      assert.equal(await handleClaude({ res, method: "POST", path: "/api/claude/usage" }), false);
      now += 300001;
      await claudeUsage();
      assert.equal(calls, 2);
    });
    await t.test("429 with zero Retry-After backs off 5/10/20/30 minutes across all callers", async () => {
      reset(); calls = 0;
      globalThis.fetch = async () => {
        calls++;
        return new Response("SECRET", { status: 429, headers: { "Retry-After": "0" } });
      };
      for (const minutes of [5, 10, 20, 30, 30]) {
        const before = calls;
        const [a, b] = await Promise.all([claudeUsage(), claudeUsage()]);
        assert.equal(a, b);
        assert.equal(a.status, "unavailable");
        assert.equal(a.windows, null);
        assert.equal(a.nextCheckAt - now, minutes * 60000);
        assert.doesNotMatch(a.message, /SECRET/);
        now = a.nextCheckAt - 1;
        assert.equal(await claudeUsage(), a);
        assert.equal(calls, before + 1);
        now += 1;
      }
      globalThis.fetch = async () => Response.json(payload);
      assert.equal((await claudeUsage()).status, "ready");
      assert.equal(state.throttles, 0);
    });
    await t.test("Retry-After longer than fallback is respected", async () => {
      reset();
      globalThis.fetch = async () => new Response("SECRET", { status: 429, headers: { "Retry-After": "3600" } });
      assert.equal((await claudeUsage()).nextCheckAt - now, 3600000);
    });
    await t.test("expired auth and malformed responses are safe; file stays unchanged", async () => {
      for (const status of [401, 403, 500]) {
        reset();
        globalThis.fetch = async () => new Response("SECRET", { status });
        const result = await claudeUsage();
        assert.equal(result.status, "unavailable");
        assert.doesNotMatch(result.message, /SECRET/);
        if (status === 401) assert.match(result.message, /истекла/);
      }
      globalThis.fetch = async () => new Response("SECRET invalid JSON");
      await assert.rejects(readClaudeUsage(), /Некорректный ответ/);
      assert.equal(await readFile(path, "utf8"), auth);
    });
    await t.test("timeout errors hide request credentials", async () => {
      globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET")), { once: true });
      });
      const keepAlive = setInterval(() => {}, 100);
      try { await assert.rejects(readClaudeUsage(20), /Не удалось получить/); }
      finally { clearInterval(keepAlive); }
    });
  } finally {
    Date.now = realNow;
    globalThis.fetch = previousFetch;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    reset();
    await rm(directory, { recursive: true, force: true });
  }
});
