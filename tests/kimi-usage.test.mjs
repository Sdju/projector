import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiWindows } from "../server/modules/agents-integration/kimi/usage.ts";
import { kimiUsage } from "../server/modules/agents-integration/kimi/index.ts";
import { handleKimi } from "../server/routes/api/kimi.ts";

const payload = {
  usages: {
    limit_5h: { used_ratio: 0.155, reset_time: "2030-01-01T12:00:00Z" },
    limit_month_total: { used_ratio: 0.3, reset_time: "2030-02-01T00:00:00Z" },
  },
};

test("Kimi windows normalize ratios, reset times and exhausted limits; absent windows drop out", () => {
  const parsed = kimiWindows(payload);
  expect(parsed?.rolling?.usedPercent).toBe(15.5);
  expect(parsed?.weekly).toBe(undefined);
  expect(parsed?.monthly?.usedPercent).toBe(30);
  expect(parsed?.rolling?.resetsAt).toBe(Date.parse("2030-01-01T12:00:00Z") / 1000);
  expect(parsed?.monthly?.limited).toBe(false);
  expect(
    kimiWindows({
      usages: { limit_5h: { used_ratio: 1.5 }, limit_7d: { used_ratio: 0 } },
      totalQuota: { used: 1000, limit: 1000 },
    }),
  ).toMatchObject({
    rolling: { usedPercent: 100, limited: true },
    weekly: { usedPercent: 0 },
    monthly: { limited: true },
  });
  for (const value of [-0.1, NaN, Infinity, "42", null])
    expect(
      kimiWindows({
        usages: { limit_5h: { used_ratio: 0.1 }, limit_7d: { used_ratio: value } },
      })?.weekly,
    ).toBe(undefined);
  for (const value of [null, {}, { usages: {} }, { usages: { limit_5h: {} } }, { limits: [] }])
    expect(kimiWindows(value)).toBe(null);
});

describe("Kimi reads CLI credentials, bounds and sanitizes requests, shares cached results", () => {
  let directory, previousFetch, previousEnv, state, calls;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-kimi-"));
    previousFetch = globalThis.fetch;
    previousEnv = {
      HOME: process.env.HOME,
      KIMI_AUTH_CONTENT: process.env.KIMI_AUTH_CONTENT,
    };
    state = globalThis.projectorKimiUsage;
    calls = 0;
    process.env.HOME = directory;
    delete process.env.KIMI_AUTH_CONTENT;
    await mkdir(join(directory, ".kimi-code", "credentials"), { recursive: true });
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

  const credential = (overrides = {}) =>
    JSON.stringify({
      access_token: "file-fixture",
      refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    });

  test("missing, damaged and expired credentials never leak file contents", async () => {
    globalThis.fetch = () => {
      throw new Error("must not request without a token");
    };
    const missing = await kimiUsage();
    expect(missing.status).toBe("unavailable");
    expect(missing.message).toMatch(/Авторизация Kimi Code недоступна/);
    await writeFile(
      join(directory, ".kimi-code", "credentials", "kimi-code-env-a.json"),
      "SECRET invalid JSON",
    );
    await writeFile(
      join(directory, ".kimi-code", "credentials", "kimi-code-env-b.json"),
      credential({ expires_at: Math.floor(Date.now() / 1000) - 10 }),
    );
    const damaged = await kimiUsage();
    expect(damaged.status).toBe("unavailable");
    expect(damaged.message).not.toMatch(/SECRET/);
  });

  test("the env-suffixed credential file and the env override yield only the token", async () => {
    state.value = undefined;
    calls = 0;
    await writeFile(
      join(directory, ".kimi-code", "credentials", "kimi-code-env-b.json"),
      credential(),
    );
    globalThis.fetch = async (url, options) => {
      calls++;
      expect(url).toBe("https://api.kimi.com/coding/v1/usages");
      expect(options.headers.Authorization).toBe("Bearer file-fixture");
      expect(options.redirect).toBe("error");
      expect(options.signal instanceof AbortSignal).toBeTruthy();
      return Response.json({ ...payload, account: "SECRET" });
    };
    const fromFile = await kimiUsage();
    expect(fromFile.status).toBe("ready");
    state.value = undefined;
    process.env.KIMI_AUTH_CONTENT = credential({ access_token: "env-fixture" });
    globalThis.fetch = async (url, options) => {
      expect(options.headers.Authorization).toBe("Bearer env-fixture");
      return Response.json(payload);
    };
    expect((await kimiUsage()).status).toBe("ready");
  });

  test("concurrent polls and the HTTP route share one cached request", async () => {
    state.value = undefined;
    calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ ...payload, account: "SECRET" });
    };
    const [a, b] = await Promise.all([kimiUsage(), kimiUsage()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(await kimiUsage()).toBe(a);
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
    expect(await handleKimi({ res, method: "GET", path: "/api/kimi/usage" })).toBe(true);
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(a);
    expect(body).not.toMatch(/SECRET|fixture|Authorization|refresh_token/);
    expect(calls).toBe(1);
    expect(await handleKimi({ res, method: "POST", path: "/api/kimi/usage" })).toBe(false);
    state.value.checkedAt -= 60001;
    await kimiUsage();
    expect(calls).toBe(2);
  });

  test("auth errors and malformed responses do not expose upstream bodies", async () => {
    for (const status of [401, 403, 429, 500]) {
      state.value = undefined;
      globalThis.fetch = async () => new Response("SECRET upstream details", { status });
      const result = await kimiUsage();
      expect(result.status).toBe("unavailable");
      expect(result.windows).toBe(null);
      expect(result.message).not.toMatch(/SECRET|fixture/);
      if (status === 401) expect(result.message).toMatch(/истекла/);
      if (status === 403) expect(result.message).toMatch(/Подписка/);
    }
    state.value = undefined;
    globalThis.fetch = async () => new Response("SECRET invalid JSON");
    expect((await kimiUsage()).message).toMatch(/Некорректный ответ/);
    state.value = undefined;
    globalThis.fetch = async () => Response.json({ limits: [] });
    const partial = await kimiUsage();
    expect(partial.status).toBe("unavailable");
    expect(partial.message).toMatch(/недоступны/);
  });

  test("a hanging request times out without returning credentials", async () => {
    state.value = undefined;
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET request")), {
          once: true,
        });
      });
    const keepAlive = setInterval(() => {}, 100);
    try {
      const result = await kimiUsage();
      expect(result.message).toMatch(/Не удалось получить лимиты/);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
