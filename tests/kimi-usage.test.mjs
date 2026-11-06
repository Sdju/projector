import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kimiWindows } from "../packages/server/modules/agents-integration/kimi/usage.ts";
import { kimiUsage } from "../packages/server/modules/agents-integration/kimi/index.ts";
import { handleKimi } from "../packages/server/routes/api/kimi.ts";

const payload = {
  usages: {
    limit_5h: { used_ratio: 0.155, reset_time: "2030-01-01T12:00:00Z" },
    limit_month_total: { used_ratio: 0.3, reset_time: "2030-02-01T00:00:00Z" },
  },
};

const now = () => Math.floor(Date.now() / 1000);
const target = (url) => (typeof url === "string" ? url : url instanceof URL ? url.href : "");
const credentialPath = (directory, slot = "kimi-code-env-test") =>
  join(directory, ".kimi-code", "credentials", `${slot}.json`);
const configPath = (directory) => join(directory, ".kimi-code", "config.toml");

const credential = (overrides = {}) =>
  JSON.stringify({
    access_token: "file-fixture",
    refresh_token: "refresh-fixture",
    expires_at: now() + 3600,
    expires_in: 3600,
    scope: "kimi-code",
    token_type: "Bearer",
    ...overrides,
  });

async function writeConfig(directory, key = "oauth/kimi-code-env-test") {
  await mkdir(join(directory, ".kimi-code"), { recursive: true });
  await writeFile(
    configPath(directory),
    [
      '[providers."managed:kimi-code"]',
      'base_url = "https://api.kimi.ai/coding/v1"',
      '[providers."managed:kimi-code".oauth]',
      'storage = "file"',
      `key = "${key}"`,
      'oauth_host = "https://auth.kimi.ai"',
      "",
    ].join("\n"),
  );
}

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
  for (const value of [-0.1, NaN, Infinity, null])
    expect(
      kimiWindows({
        usages: { limit_5h: { used_ratio: 0.1 }, limit_7d: { used_ratio: value } },
      })?.weekly,
    ).toBe(undefined);
  for (const value of [null, {}, { usages: {} }, { usages: { limit_5h: {} } }, { limits: [] }])
    expect(kimiWindows(value)).toBe(null);
});

test("Kimi accepts ratio strings, month_code and the legacy count shape", () => {
  expect(kimiWindows({ usages: { limit_5h: { used_ratio: "0.5" } } })?.rolling?.usedPercent).toBe(
    50,
  );
  expect(
    kimiWindows({ usages: { limit_month_code: { used_ratio: 0.25 } } })?.monthly?.usedPercent,
  ).toBe(25);
  expect(
    kimiWindows({
      usage: { limit: "100", used: "12", resetTime: "2030-01-01T00:00:00Z" },
      limits: [
        {
          window: { duration: 300, timeUnit: "TIME_UNIT_MINUTE" },
          detail: { limit: "100", used: "100" },
        },
      ],
    }),
  ).toMatchObject({ rolling: { limited: true }, weekly: { usedPercent: 12 } });
});

describe("Kimi reads CLI credentials, bounds and sanitizes requests, shares cached results", () => {
  let directory, previousFetch, previousEnv, state, calls;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-kimi-"));
    previousFetch = globalThis.fetch;
    previousEnv = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      KIMI_AUTH_CONTENT: process.env.KIMI_AUTH_CONTENT,
      KIMI_CODE_HOME: process.env.KIMI_CODE_HOME,
      KIMI_OAUTH_HOST: process.env.KIMI_OAUTH_HOST,
      KIMI_CODE_OAUTH_HOST: process.env.KIMI_CODE_OAUTH_HOST,
    };
    state = globalThis.projectorKimiUsage;
    calls = 0;
    // `os.homedir()` reads HOME on POSIX and USERPROFILE on Windows.
    process.env.HOME = directory;
    process.env.USERPROFILE = directory;
    delete process.env.KIMI_AUTH_CONTENT;
    delete process.env.KIMI_CODE_HOME;
    delete process.env.KIMI_OAUTH_HOST;
    delete process.env.KIMI_CODE_OAUTH_HOST;
    await mkdir(join(directory, ".kimi-code", "credentials"), { recursive: true });
  });
  beforeEach(async () => {
    state.value = undefined;
    globalThis.projectorKimiEnvCredential = undefined;
    delete process.env.KIMI_AUTH_CONTENT;
    await rm(join(directory, ".kimi-code", "credentials"), { recursive: true, force: true });
    await mkdir(join(directory, ".kimi-code", "credentials"), { recursive: true });
    await rm(configPath(directory), { force: true });
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    state.value = undefined;
    globalThis.projectorKimiEnvCredential = undefined;
    await rm(directory, { recursive: true, force: true });
  });

  const writeCredential = (overrides = {}, slot = "kimi-code-env-test") =>
    writeFile(credentialPath(directory, slot), credential(overrides));

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
      credential({ expires_at: now() - 10, refresh_token: "" }),
    );
    state.value = undefined;
    const damaged = await kimiUsage();
    expect(damaged.status).toBe("unavailable");
    expect(damaged.message).toMatch(/истекла/);
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
    await writeCredential();
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

  test("an expiring token is refreshed through the current CLI slot and written back", async () => {
    await writeConfig(directory);
    await writeCredential({
      access_token: "old-token",
      refresh_token: "refresh-1",
      expires_at: now() - 10,
      expires_in: 900,
      custom_field: "keep-me",
    });
    let usageToken = null;
    globalThis.fetch = async (url, options) => {
      if (target(url) === "https://auth.kimi.ai/api/oauth/token") {
        expect(options.method).toBe("POST");
        const form = new URLSearchParams(options.body);
        expect(form.get("grant_type")).toBe("refresh_token");
        expect(form.get("client_id")).toBe("17e5f671-d194-4dfb-9706-5516cb48c098");
        expect(form.get("refresh_token")).toBe("refresh-1");
        expect(options.redirect).toBe("error");
        return Response.json({
          access_token: "fresh-token",
          refresh_token: "refresh-2",
          expires_in: 900,
          token_type: "Bearer",
        });
      }
      expect(target(url)).toBe("https://api.kimi.com/coding/v1/usages");
      usageToken = options.headers.Authorization;
      return Response.json(payload);
    };
    const result = await kimiUsage();
    expect(result.status).toBe("ready");
    expect(usageToken).toBe("Bearer fresh-token");
    const saved = JSON.parse(await readFile(credentialPath(directory), "utf8"));
    expect(saved.access_token).toBe("fresh-token");
    expect(saved.refresh_token).toBe("refresh-2");
    expect(saved.expires_at).toBeGreaterThan(now());
    expect(saved.custom_field).toBe("keep-me");
    await expect(
      stat(join(directory, ".kimi-code", "oauth", "kimi-code-env-test.lock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a rejected access token forces one refresh and retries the request", async () => {
    await writeConfig(directory);
    await writeCredential({ access_token: "rejected-token", expires_at: now() + 3600 });
    let usageCalls = 0;
    globalThis.fetch = async (url, options) => {
      if (target(url).endsWith("/api/oauth/token")) {
        return Response.json({
          access_token: "fresh-token",
          refresh_token: "refresh-2",
          expires_in: 900,
        });
      }
      usageCalls++;
      if (usageCalls === 1) return new Response("rejected", { status: 401 });
      expect(options.headers.Authorization).toBe("Bearer fresh-token");
      return Response.json(payload);
    };
    expect((await kimiUsage()).status).toBe("ready");
    expect(usageCalls).toBe(2);
  });

  test("the config slot wins over newer credential files", async () => {
    await writeConfig(directory);
    await writeCredential({ access_token: "slot-token", expires_at: now() + 3600 });
    await writeCredential(
      { access_token: "other-token", expires_at: now() + 3600 },
      "kimi-code-env-other",
    );
    globalThis.fetch = async (_url, options) => {
      expect(options.headers.Authorization).toBe("Bearer slot-token");
      return Response.json(payload);
    };
    expect((await kimiUsage()).status).toBe("ready");
  });

  test("auth errors and malformed responses do not expose upstream bodies", async () => {
    await writeCredential();
    for (const status of [401, 403, 429, 500]) {
      state.value = undefined;
      globalThis.fetch = async (url) => {
        if (status === 403 && target(url).endsWith("/api/oauth/token"))
          return Response.json({ access_token: "fresh", expires_in: 900 });
        return new Response("SECRET upstream details", { status });
      };
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
    await writeCredential();
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
