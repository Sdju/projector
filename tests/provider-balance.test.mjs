import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { providerBalance } from "../server/modules/providers/balance.ts";
import { deepseekEntries } from "../server/modules/providers/balance.ts";
import { inferProviderKind } from "../server/modules/providers/kinds.ts";
import { handleProvidersBalance } from "../server/routes/api/providers/balance.ts";
import { formatBalance } from "../src/modules/provider/model/format-balance.ts";

const payload = {
  is_available: true,
  balance_infos: [
    {
      currency: "CNY",
      total_balance: "110.00",
      granted_balance: "10.00",
      topped_up_balance: "100.00",
    },
  ],
};

test("kind is inferred from the provider URL", () => {
  expect(inferProviderKind("https://api.deepseek.com")).toBe("deepseek");
  expect(inferProviderKind("https://dashscope-intl.aliyuncs.com/compatible-mode/v1")).toBe(
    "qwencloud",
  );
  for (const url of ["http://localhost:11434/v1", "127.0.0.1:1234", "http://192.168.1.5/v1"])
    expect(inferProviderKind(url)).toBe("local");
  expect(inferProviderKind("https://api.example.com/v1")).toBe("custom");
  expect(inferProviderKind("")).toBe("custom");
});

test("DeepSeek balance payload is validated and kept as decimal strings", () => {
  expect(deepseekEntries(payload)).toStrictEqual([
    { currency: "CNY", total: "110.00", granted: "10.00", toppedUp: "100.00" },
  ]);
  expect(formatBalance(deepseekEntries(payload))).toBe("¥110.00");
  expect(
    formatBalance([
      { currency: "USD", total: "5.20", granted: "0", toppedUp: "5.20" },
      { currency: "EUR", total: "1", granted: "0", toppedUp: "1" },
    ]),
  ).toBe("$5.20 · 1 EUR");
  for (const value of [
    null,
    {},
    { balance_infos: {} },
    {
      balance_infos: [
        { currency: "CNY", total_balance: "abc", granted_balance: "0", topped_up_balance: "0" },
      ],
    },
    { balance_infos: [{ total_balance: "1", granted_balance: "0", topped_up_balance: "0" }] },
  ])
    expect(deepseekEntries(value)).toBe(null);
});

describe("balance of the active provider", () => {
  let directory, previousFetch, previousEnv;
  const keys = ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "QWEN_URL"];
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-balance-"));
    previousFetch = globalThis.fetch;
    previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.XDG_DATA_HOME = directory;
    process.env.OPENAI_URL = "https://api.deepseek.com";
    process.env.OPENAI_API_KEY = "sk-fixture";
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.QWEN_URL;
  });
  afterAll(async () => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.projectorProviderBalance?.clear();
    await rm(directory, { recursive: true, force: true });
  });

  test("calls the provider origin once per minute with the key, no redirects", async () => {
    globalThis.projectorProviderBalance?.clear();
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      expect(url).toBe("https://api.deepseek.com/user/balance");
      expect(options.headers.Authorization).toBe("Bearer sk-fixture");
      expect(options.redirect).toBe("error");
      return Response.json({ ...payload, account: "SECRET" });
    };
    const [a, b] = await Promise.all([providerBalance(), providerBalance()]);
    expect(a).toBe(b);
    expect(a.status).toBe("ready");
    expect(a.available).toBe(true);
    expect(await providerBalance()).toBe(a);
    expect(calls).toBe(1);
    const headers = {};
    let body;
    const res = {
      setHeader: (key, value) => (headers[key] = value),
      end: (value) => (body = value),
    };
    const url = new URL("http://localhost/api/providers/balance");
    expect(await handleProvidersBalance({ res, url, method: "GET", path: url.pathname })).toBe(
      true,
    );
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(JSON.parse(body)).toStrictEqual(a);
    expect(body).not.toMatch(/SECRET|sk-fixture/);
    expect(await handleProvidersBalance({ res, url, method: "POST", path: url.pathname })).toBe(
      false,
    );
  });

  test("errors are explicit and never echo upstream bodies", async () => {
    for (const status of [401, 402, 500]) {
      globalThis.projectorProviderBalance?.clear();
      globalThis.fetch = async () => new Response("SECRET upstream details", { status });
      const result = await providerBalance();
      expect(result.status).toBe("unavailable");
      expect(result.entries).toStrictEqual([]);
      expect(result.message).not.toMatch(/SECRET|sk-fixture/);
    }
    globalThis.projectorProviderBalance?.clear();
    globalThis.fetch = async () => new Response("SECRET not json");
    expect((await providerBalance()).message).toMatch(/Некорректный/);
    globalThis.fetch = async () => {
      throw new Error("SECRET network");
    };
    globalThis.projectorProviderBalance?.clear();
    expect((await providerBalance()).message).not.toMatch(/SECRET/);
  });

  test("providers without a balance API are unsupported and make no request", async () => {
    globalThis.projectorProviderBalance?.clear();
    globalThis.fetch = () => {
      throw new Error("must not request");
    };
    const qwen = await providerBalance("qwen-dashscope");
    expect(qwen.status).toBe("unsupported");
    expect(qwen.message).toMatch(/Qwen/);
  });
});
