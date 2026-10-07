import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { os } from "../core/modules/os/index.ts";
import { readGoUsage } from "../server/modules/agents-integration/opencode/client.ts";
import { goWindows, openCodeUsage } from "../server/modules/agents-integration/opencode/usage.ts";
import { handleOpenCode } from "../server/routes/api/opencode.ts";
import { resetCountdown } from "../src/common/utilities/reset-time.ts";

const window = { status: "ok", percent: 42, resetsAt: "2026-10-10T12:00:00Z" };
const payload = { usage: { rolling: window, weekly: window, monthly: window } };

test("compact reset countdown handles missing, expired and minute/hour/day boundaries", () => {
  const now = 1791150000000;
  const reset = (seconds) => resetCountdown(now / 1000 + seconds, now);
  for (const value of [null, undefined, NaN, Infinity])
    expect(resetCountdown(value, now)).toBe("—");
  expect(reset(-10)).toBe("сейчас");
  expect(reset(0)).toBe("сейчас");
  expect(reset(59)).toBe("<1м");
  expect(reset(60)).toBe("1м");
  expect(reset(3599)).toBe("59м");
  expect(reset(3600)).toBe("1ч");
  expect(reset(8100)).toBe("2ч 15м");
  expect(reset(86400)).toBe("1д");
  expect(reset(187200)).toBe("2д 4ч");
});

test("Go windows validate percentages and status, normalize resets and exhausted limits", () => {
  const parsed = goWindows(payload);
  expect(parsed.weekly.usedPercent).toBe(42);
  expect(parsed.weekly.resetsAt).toBe(Date.parse(window.resetsAt) / 1000);
  expect(parsed.weekly.limited).toBe(false);
  expect(
    goWindows({
      usage: { ...payload.usage, rolling: { ...window, status: "rate-limited", percent: 99 } },
    }).rolling.usedPercent,
  ).toBe(100);
  expect(
    goWindows({ usage: { ...payload.usage, weekly: { ...window, resetsAt: "invalid" } } }).weekly
      .resetsAt,
  ).toBe(null);
  for (const percent of [-1, 101, NaN, Infinity, "42", null])
    expect(goWindows({ usage: { ...payload.usage, weekly: { ...window, percent } } })).toBe(null);
  for (const value of [
    null,
    {},
    { usage: [] },
    { usage: { weekly: window } },
    { usage: { ...payload.usage, monthly: { ...window, status: "unknown" } } },
  ])
    expect(goWindows(value)).toBe(null);
});

describe("Go reads existing auth, bounds and sanitizes requests, shares cached API results", () => {
  let directory, previousFetch, previousEnv, state, calls, authFile;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-opencode-"));
    previousFetch = globalThis.fetch;
    previousEnv = {
      XDG_DATA_HOME: process.env.XDG_DATA_HOME,
      OPENCODE_AUTH_CONTENT: process.env.OPENCODE_AUTH_CONTENT,
    };
    state = globalThis.projectorOpenCodeUsage;
    calls = 0;
    process.env.XDG_DATA_HOME = directory;
    delete process.env.OPENCODE_AUTH_CONTENT;
    await mkdir(join(directory, "opencode"));
    authFile = join(directory, "opencode", "auth.json");
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

  test("missing Go auth is explicit; Zen auth is never substituted", async () => {
    await writeFile(authFile, JSON.stringify({ opencode: { key: "zen-only" } }));
    globalThis.fetch = () => {
      throw new Error("must not request without Go auth");
    };
    const result = await openCodeUsage();
    expect(result.status).toBe("unavailable");
    expect(result.message).toMatch(/Go не подключён/);
    expect(result.windows).toBe(null);
    await writeFile(authFile, "SECRET invalid JSON");
    await expect(os.tools.readOpenCodeGoKey()).rejects.toSatisfy(
      (error) => !error.message.includes("SECRET"),
    );
  });
  test("XDG file and OpenCode env override use only the Go entry", async () => {
    await writeFile(authFile, JSON.stringify({ "opencode-go": { key: "file-fixture" } }));
    expect(await os.tools.readOpenCodeGoKey()).toBe("file-fixture");
    process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({ "opencode-go": { key: "env-fixture" } });
    expect(await os.tools.readOpenCodeGoKey()).toBe("env-fixture");
  });
  test("concurrent polls, repeated reads and HTTP route share one request", async () => {
    state.value = undefined;
    globalThis.fetch = async (url, options) => {
      calls++;
      expect(url).toBe("https://opencode.ai/zen/go/v1/usage");
      expect(options.headers.Authorization).toBe("Bearer env-fixture");
      expect(options.redirect).toBe("error");
      expect(options.signal instanceof AbortSignal).toBeTruthy();
      return Response.json({ ...payload, account: "SECRET" });
    };
    const [a, b] = await Promise.all([openCodeUsage(), openCodeUsage()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(await openCodeUsage()).toBe(a);
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
    expect(await handleOpenCode({ res, method: "GET", path: "/api/opencode/usage" })).toBe(true);
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(body)).toStrictEqual(a);
    expect(body).not.toMatch(/SECRET|fixture|Authorization/);
    expect(calls).toBe(1);
    expect(await handleOpenCode({ res, method: "POST", path: "/api/opencode/usage" })).toBe(false);
    state.value.checkedAt -= 60001;
    await openCodeUsage();
    expect(calls).toBe(2);
  });
  test("auth errors and malformed responses do not expose upstream bodies", async () => {
    for (const status of [401, 403, 429, 500]) {
      state.value = undefined;
      globalThis.fetch = async () => new Response("SECRET upstream details", { status });
      const result = await openCodeUsage();
      expect(result.status).toBe("unavailable");
      expect(result.windows).toBe(null);
      expect(result.message).not.toMatch(/SECRET|fixture/);
      if (status === 401) expect(result.message).toMatch(/истекла/);
      if (status === 403) expect(result.message).toMatch(/Подписка/);
    }
    globalThis.fetch = async () => new Response("SECRET invalid JSON");
    await expect(readGoUsage()).rejects.toThrow(/Некорректный ответ/);
    state.value = undefined;
    globalThis.fetch = async () => Response.json({ usage: { weekly: window } });
    expect((await openCodeUsage()).status).toBe("unavailable");
  });
  test("hanging requests time out without returning credentials", async () => {
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("SECRET request")), {
          once: true,
        });
      });
    // AbortSignal.timeout's timer does not keep Node alive by itself.
    const keepAlive = setInterval(() => {}, 100);
    try {
      await expect(readGoUsage(20)).rejects.toThrow(/Не удалось получить лимиты/);
    } finally {
      clearInterval(keepAlive);
    }
  });
});
