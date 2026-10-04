import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../core/modules/os/index.ts";
import { readCursorUsage } from "../server/modules/cursor/client.ts";
import { cursorWindows, cursorUsage } from "../server/modules/cursor/usage.ts";
import { handleCursor } from "../server/routes/api/cursor.ts";

const payload = {
  billingCycleEnd: "1792862002000",
  planUsage: {
    totalPercentUsed: 15.5,
    autoPercentUsed: 12.4,
    apiPercentUsed: 45.5,
  },
};

test("Cursor windows normalize percentages, billing reset and exhausted limits", () => {
  const parsed = cursorWindows(payload);
  assert.equal(parsed.total.usedPercent, 15.5);
  assert.equal(parsed.auto.usedPercent, 12.4);
  assert.equal(parsed.api.usedPercent, 45.5);
  assert.equal(parsed.total.resetsAt, 1792862002);
  assert.equal(parsed.total.limited, false);
  assert.equal(
    cursorWindows({
      ...payload,
      planUsage: { ...payload.planUsage, apiPercentUsed: 100 },
    }).api.limited,
    true,
  );
  assert.equal(
    cursorWindows({
      ...payload,
      planUsage: { ...payload.planUsage, totalPercentUsed: 150 },
    }).total.usedPercent,
    100,
  );
  assert.equal(cursorWindows({ ...payload, billingCycleEnd: "invalid" }).total.resetsAt, null);
  for (const value of [-1, NaN, Infinity, "42", null])
    assert.equal(cursorWindows({
      ...payload,
      planUsage: { ...payload.planUsage, weekly: value, autoPercentUsed: value },
    }), null);
  for (const value of [null, {}, { planUsage: [] }, { planUsage: { totalPercentUsed: 1 } }])
    assert.equal(cursorWindows(value), null);
});

test("Cursor reads existing auth, bounds and sanitizes requests, shares cached API results", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "projector-cursor-"));
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    CURSOR_AUTH_CONTENT: process.env.CURSOR_AUTH_CONTENT,
  };
  const state = globalThis.projectorCursorUsage;
  let calls = 0;
  process.env.XDG_CONFIG_HOME = directory;
  delete process.env.CURSOR_AUTH_CONTENT;
  await mkdir(join(directory, "cursor"));
  const authFile = join(directory, "cursor", "auth.json");
  try {
    await t.test("missing auth is explicit and never leaks file contents", async () => {
      await writeFile(authFile, JSON.stringify({ refreshToken: "only-refresh" }));
      globalThis.fetch = () => { throw new Error("must not request without access token"); };
      const result = await cursorUsage();
      assert.equal(result.status, "unavailable");
      assert.match(result.message, /Авторизация Cursor недоступна/);
      assert.equal(result.windows, null);
      await writeFile(authFile, "SECRET invalid JSON");
      await assert.rejects(
        os.tools.readCursorAccessToken(),
        (error) => !error.message.includes("SECRET"),
      );
    });
    await t.test("XDG file and Cursor env override use only the access token", async () => {
      await writeFile(authFile, JSON.stringify({ accessToken: "file-fixture", refreshToken: "r" }));
      assert.equal(await os.tools.readCursorAccessToken(), "file-fixture");
      process.env.CURSOR_AUTH_CONTENT = JSON.stringify({ accessToken: "env-fixture" });
      assert.equal(await os.tools.readCursorAccessToken(), "env-fixture");
    });
    await t.test("concurrent polls, repeated reads and HTTP route share one request", async () => {
      state.value = undefined;
      globalThis.fetch = async (url, options) => {
        calls++;
        assert.equal(
          url,
          "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
        );
        assert.equal(options.method, "POST");
        assert.equal(options.headers.Authorization, "Bearer env-fixture");
        assert.equal(options.redirect, "error");
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ ...payload, account: "SECRET" });
      };
      const [a, b] = await Promise.all([cursorUsage(), cursorUsage()]);
      assert.equal(a, b);
      assert.equal(a.status, "ready");
      assert.equal(await cursorUsage(), a);
      const headers = {};
      let body;
      const res = { setHeader: (key, value) => { headers[key] = value; }, end: (value) => { body = value; } };
      assert.equal(await handleCursor({ res, method: "GET", path: "/api/cursor/usage" }), true);
      assert.equal(headers["Cache-Control"], "no-store");
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(body), a);
      assert.doesNotMatch(body, /SECRET|fixture|Authorization|refreshToken/);
      assert.equal(calls, 1);
      assert.equal(await handleCursor({ res, method: "POST", path: "/api/cursor/usage" }), false);
      state.value.checkedAt -= 60001;
      await cursorUsage();
      assert.equal(calls, 2);
    });
    await t.test("auth errors and malformed responses do not expose upstream bodies", async () => {
      for (const status of [401, 403, 429, 500]) {
        state.value = undefined;
        globalThis.fetch = async () => new Response("SECRET upstream details", { status });
        const result = await cursorUsage();
        assert.equal(result.status, "unavailable");
        assert.equal(result.windows, null);
        assert.doesNotMatch(result.message, /SECRET|fixture/);
        if (status === 401) assert.match(result.message, /истекла/);
        if (status === 403) assert.match(result.message, /Подписка/);
      }
      globalThis.fetch = async () => new Response("SECRET invalid JSON");
      await assert.rejects(readCursorUsage(), /Некорректный ответ/);
      state.value = undefined;
      globalThis.fetch = async () => Response.json({ planUsage: { totalPercentUsed: 1 } });
      assert.equal((await cursorUsage()).status, "unavailable");
    });
    await t.test("hanging requests time out without returning credentials", async () => {
      globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET request")), { once: true });
      });
      const keepAlive = setInterval(() => {}, 100);
      try { await assert.rejects(readCursorUsage(20), /Не удалось получить лимиты/); }
      finally { clearInterval(keepAlive); }
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    state.value = undefined;
    await rm(directory, { recursive: true, force: true });
  }
});
