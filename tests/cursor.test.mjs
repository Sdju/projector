import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../core/modules/os/index.ts";
import { readCursorUsage } from "../server/modules/agents-integration/cursor/client.ts";
import { cursorWindows, cursorUsage } from "../server/modules/agents-integration/cursor/usage.ts";
import { NETWORK_CONTEXT_URL } from "../server/modules/network/index.ts";
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
  expect(parsed.total.usedPercent).toBe(15.5);
  expect(parsed.auto.usedPercent).toBe(12.4);
  expect(parsed.api.usedPercent).toBe(45.5);
  expect(parsed.total.resetsAt).toBe(1792862002);
  expect(parsed.total.limited).toBe(false);
  expect(
    cursorWindows({
      ...payload,
      planUsage: { ...payload.planUsage, apiPercentUsed: 100 },
    }).api.limited,
  ).toBe(true);
  expect(
    cursorWindows({
      ...payload,
      planUsage: { ...payload.planUsage, totalPercentUsed: 150 },
    }).total.usedPercent,
  ).toBe(100);
  expect(cursorWindows({ ...payload, billingCycleEnd: "invalid" }).total.resetsAt).toBe(null);
  for (const value of [-1, NaN, Infinity, "42", null])
    expect(
      cursorWindows({
        ...payload,
        planUsage: { ...payload.planUsage, weekly: value, autoPercentUsed: value },
      }),
    ).toBe(null);
  for (const value of [null, {}, { planUsage: [] }, { planUsage: { totalPercentUsed: 1 } }])
    expect(cursorWindows(value)).toBe(null);
});

describe("Cursor reads existing auth, bounds and sanitizes requests, shares cached API results", () => {
  let directory, previousFetch, previousEnv, state, calls, authFile;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-cursor-"));
    previousFetch = globalThis.fetch;
    previousEnv = {
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      CURSOR_AUTH_CONTENT: process.env.CURSOR_AUTH_CONTENT,
    };
    state = globalThis.projectorCursorUsage;
    calls = 0;
    process.env.XDG_CONFIG_HOME = directory;
    delete process.env.CURSOR_AUTH_CONTENT;
    await mkdir(join(directory, "cursor"));
    authFile = join(directory, "cursor", "auth.json");
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    state.value = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  test("missing auth is explicit and never leaks file contents", async () => {
    await writeFile(authFile, JSON.stringify({ refreshToken: "only-refresh" }));
    globalThis.fetch = () => {
      throw new Error("must not request without access token");
    };
    const result = await cursorUsage();
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/Авторизация Cursor недоступна/);
    expect(result.windows).toBe(null);
    await writeFile(authFile, "SECRET invalid JSON");
    await expect(os.tools.readCursorAccessToken()).rejects.toSatisfy(
      (error) => !error.message.includes("SECRET"),
    );
  });
  test("XDG file and Cursor env override use only the access token", async () => {
    await writeFile(authFile, JSON.stringify({ accessToken: "file-fixture", refreshToken: "r" }));
    expect(await os.tools.readCursorAccessToken()).toBe("file-fixture");
    process.env.CURSOR_AUTH_CONTENT = JSON.stringify({ accessToken: "env-fixture" });
    expect(await os.tools.readCursorAccessToken()).toBe("env-fixture");
  });
  test("concurrent polls, repeated reads and HTTP route share one request", async () => {
    state.value = undefined;
    calls = 0;
    let cursorCalls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      if (url === NETWORK_CONTEXT_URL) {
        expect(options.method ?? "GET").toBe("GET");
        expect(options.redirect).toBe("error");
        expect(options.signal instanceof AbortSignal).toBeTruthy();
        return Response.json({ success: true, is_eu: true, ip: "SECRET" });
      }
      cursorCalls++;
      expect(url).toBe("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
      expect(options.method).toBe("POST");
      expect(options.headers.Authorization).toBe("Bearer env-fixture");
      expect(options.redirect).toBe("error");
      expect(options.signal instanceof AbortSignal).toBeTruthy();
      return Response.json({ ...payload, account: "SECRET" });
    };
    const [a, b] = await Promise.all([cursorUsage(), cursorUsage()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(await cursorUsage()).toBe(a);
    const headers = {};
    let body;
    const res = {
      setHeader: (key, value) => {
        headers[key] = value;
      },
      end: (value) => {
        body = value;
      },
    };
    expect(await handleCursor({ res, method: "GET", path: "/api/cursor/usage" })).toBe(true);
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(a);
    expect(body).not.toMatch(/SECRET|fixture|Authorization|refreshToken/);
    expect(cursorCalls).toBe(1);
    expect(calls).toBe(2);
    expect(await handleCursor({ res, method: "POST", path: "/api/cursor/usage" })).toBe(false);
    state.value.checkedAt -= 60001;
    await cursorUsage();
    expect(cursorCalls).toBe(2);
    expect(calls).toBe(4);
  });
  test("failed network probe blocks Cursor usage requests", async () => {
    state.value = undefined;
    let cursorCalls = 0;
    for (const body of [
      { success: false, is_eu: true, message: "SECRET" },
      { success: true, is_eu: false, country_code: "US" },
      { success: true, ip: "SECRET" },
    ]) {
      globalThis.fetch = async (url) => {
        if (url === NETWORK_CONTEXT_URL) return Response.json(body);
        cursorCalls++;
        throw new Error("must not request Cursor after failed probe");
      };
      const result = await cursorUsage();
      expect(result.status).toBe("unavailable");
      expect(result.windows).toBe(null);
      expect(result.message).toMatch(/сетевой контекст/);
      expect(result.message).not.toMatch(/SECRET|US/);
      state.value = undefined;
    }
    expect(cursorCalls).toBe(0);
  });
  test("auth errors and malformed responses do not expose upstream bodies", async () => {
    for (const status of [401, 403, 429, 500]) {
      state.value = undefined;
      globalThis.fetch = async (url) => {
        if (url === NETWORK_CONTEXT_URL) return Response.json({ success: true, is_eu: true });
        return new Response("SECRET upstream details", { status });
      };
      const result = await cursorUsage();
      expect(result.status).toBe("unavailable");
      expect(result.windows).toBe(null);
      expect(result.message).not.toMatch(/SECRET|fixture/);
      if (status === 401) expect(result.message).toMatch(/истекла/);
      if (status === 403) expect(result.message).toMatch(/Подписка/);
    }
    globalThis.fetch = async (url) => {
      if (url === NETWORK_CONTEXT_URL) return Response.json({ success: true, is_eu: true });
      return new Response("SECRET invalid JSON");
    };
    await expect(readCursorUsage()).rejects.toThrow(/Некорректный ответ/);
    state.value = undefined;
    globalThis.fetch = async (url) => {
      if (url === NETWORK_CONTEXT_URL) return Response.json({ success: true, is_eu: true });
      return Response.json({ planUsage: { totalPercentUsed: 1 } });
    };
    expect((await cursorUsage()).status).toBe("unavailable");
  });
  test("hanging requests time out without returning credentials", async () => {
    globalThis.fetch = (url, options) => {
      if (url === NETWORK_CONTEXT_URL) return Response.json({ success: true, is_eu: true });
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET request")), {
          once: true,
        });
      });
    };
    const keepAlive = setInterval(() => {}, 100);
    try {
      await expect(readCursorUsage(20)).rejects.toThrow(/Не удалось получить лимиты/);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
