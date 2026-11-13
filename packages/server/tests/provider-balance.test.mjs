import { createRouteDispatcher } from "../modules/transport/index.ts";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deepseekEntries,
  openrouterEntries,
  providerBalance,
  providerBalances,
} from "../modules/providers/balance.ts";
import { inferProviderKind } from "../modules/providers/kinds.ts";
import {
  resolveOpenAIProvider,
  saveProviders,
  useProviderVault,
} from "../modules/providers/index.ts";
import { createVault } from "../modules/secrets/index.ts";
import { routes } from "../routes/api/providers/balance.ts";
const handleProvidersBalance = createRouteDispatcher(routes);
import {
  combineBalances,
  formatBalance,
  formatBalances,
} from "../../client/modules/provider/model/format-balance.ts";
import { walletTotals } from "../../client/modules/analytics/model/rows.ts";
import { closeAnalyticsStore } from "../modules/usage-analytics/store.ts";

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
  expect(inferProviderKind("https://openrouter.ai/api/v1")).toBe("openrouter");
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

test("OpenRouter balance is credits minus usage with exact decimal arithmetic", () => {
  const entries = openrouterEntries({ data: { total_credits: 100.5, total_usage: 25.75 } });
  expect(entries).toStrictEqual([
    { currency: "USD", total: "74.75", granted: "0", toppedUp: "100.5" },
  ]);
  expect(formatBalance(entries)).toBe("$74.75");
  expect(
    openrouterEntries({ data: { total_credits: "0.30", total_usage: "0.1" } })?.[0].total,
  ).toBe("0.20");
  for (const value of [
    null,
    {},
    { data: {} },
    { data: { total_credits: "abc", total_usage: 1 } },
    { data: { total_credits: -1, total_usage: 0 } },
    { data: { total_credits: 1, total_usage: 2 } },
  ])
    expect(openrouterEntries(value)).toBe(null);
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
    closeAnalyticsStore();
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

  test("reads the OpenRouter wallet with the management key", async () => {
    process.env.OPENAI_URL = "https://openrouter.ai/api/v1";
    globalThis.projectorProviderBalance?.clear();
    try {
      globalThis.fetch = async (url, options) => {
        expect(url).toBe("https://openrouter.ai/api/v1/credits");
        expect(options.headers.Authorization).toBe("Bearer sk-fixture");
        expect(options.redirect).toBe("error");
        return Response.json({ data: { total_credits: 100.5, total_usage: 25.75 } });
      };
      const result = await providerBalance();
      expect(result.status).toBe("ready");
      expect(result.providerKind).toBe("openrouter");
      expect(result.entries).toStrictEqual([
        { currency: "USD", total: "74.75", granted: "0", toppedUp: "100.5" },
      ]);
      expect(JSON.stringify(result)).not.toMatch(/sk-fixture/);

      globalThis.projectorProviderBalance?.clear();
      globalThis.fetch = async () => new Response("SECRET", { status: 403 });
      expect((await providerBalance()).message).toMatch(/management key/);
    } finally {
      process.env.OPENAI_URL = "https://api.deepseek.com";
    }
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
    expect(qwen.message).toMatch(/баланс недоступен/);
  });
});

describe("balances of every enabled wallet", () => {
  let directory, previousFetch, previousEnv;
  const keys = ["XDG_DATA_HOME", "OPENAI_URL", "OPENAI_API_KEY", "DASHSCOPE_API_KEY", "QWEN_URL"];

  async function fakeKeyringStore() {
    const items = new Map();
    useProviderVault(
      createVault(
        {
          available: async () => true,
          get: async (key) => items.get(key.account),
          set: async (key, _label, value) => void items.set(key.account, value),
          delete: async (key) => void items.delete(key.account),
        },
        () => undefined,
      ),
    );
  }

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "projector-wallets-"));
    previousFetch = globalThis.fetch;
    previousEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    process.env.XDG_DATA_HOME = directory;
    delete process.env.OPENAI_URL;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DASHSCOPE_API_KEY;
    delete process.env.QWEN_URL;
    await fakeKeyringStore();
    await saveProviders(
      {
        activeProviderId: "a",
        providers: [
          {
            id: "a",
            name: "Wallet A",
            kind: "deepseek",
            url: "https://api.deepseek.com",
            models: [{ id: "deepseek-chat", alias: "deepseek-chat" }],
            apiKey: "sk-a",
          },
          {
            id: "b",
            name: "Wallet B",
            kind: "deepseek",
            url: "https://api.deepseek.com",
            models: [{ id: "deepseek-chat", alias: "deepseek-chat-b" }],
            apiKey: "sk-b",
          },
        ],
      },
      {},
    );
  });

  afterAll(async () => {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.projectorProviderBalance?.clear();
    closeAnalyticsStore();
    await rm(directory, { recursive: true, force: true });
  });

  test("asks each key for its own balance and never leaks the keys", async () => {
    globalThis.projectorProviderBalance?.clear();
    const seen = [];
    globalThis.fetch = async (_url, options) => {
      const key = options.headers.Authorization;
      seen.push(key);
      return Response.json({
        is_available: true,
        balance_infos: [
          {
            currency: "USD",
            total_balance: key === "Bearer sk-a" ? "5.00" : "7.50",
            granted_balance: "0",
            topped_up_balance: "5.00",
          },
        ],
      });
    };
    const wallets = await providerBalances();
    expect(seen.sort((a, b) => a.localeCompare(b))).toEqual(["Bearer sk-a", "Bearer sk-b"]);
    expect(
      wallets.map((wallet) => wallet.providerId).sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["a", "b"]);
    expect(wallets.find((wallet) => wallet.providerId === "a")?.entries[0].total).toBe("5.00");
    expect(wallets.find((wallet) => wallet.providerId === "b")?.entries[0].total).toBe("7.50");
    expect(formatBalances(wallets)).toBe("$12.50");
    expect(JSON.stringify(wallets)).not.toMatch(/sk-a|sk-b/);

    const url = new URL("http://localhost/api/providers/balances");
    const res = {
      headers: {},
      setHeader: (key, value) => (res.headers[key] = value),
      end: (value) => (res.body = value),
    };
    expect(await handleProvidersBalance({ res, url, method: "GET", path: url.pathname })).toBe(
      true,
    );
    expect(res.headers["Cache-Control"]).toBe("no-store");
    const body = JSON.parse(res.body);
    expect(body.wallets).toHaveLength(2);
    expect(body.wallets[0].providerId).toBe("a");
  });

  test("disabled wallets are not polled and missing kinds stay out of the total", async () => {
    globalThis.projectorProviderBalance?.clear();
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return Response.json(payload);
    };
    await saveProviders(
      {
        activeProviderId: "a",
        providers: [
          {
            id: "a",
            name: "Wallet A",
            kind: "deepseek",
            url: "https://api.deepseek.com",
            enabled: true,
            models: [{ id: "deepseek-chat" }],
          },
          {
            id: "b",
            name: "Wallet B",
            kind: "deepseek",
            url: "https://api.deepseek.com",
            enabled: false,
            models: [{ id: "deepseek-chat-b" }],
          },
        ],
      },
      {},
    );
    const wallets = await providerBalances();
    expect(wallets).toHaveLength(1);
    expect(wallets[0].providerId).toBe("a");
    expect(calls).toBe(1);
  });

  test("OpenRouter management key is separate from the model API key", async () => {
    globalThis.projectorProviderBalance?.clear();
    const state = await saveProviders(
      {
        activeProviderId: "router",
        providers: [
          {
            id: "router",
            name: "OpenRouter",
            kind: "openrouter",
            url: "https://openrouter.ai/api/v1",
            models: [{ id: "openrouter/auto" }],
            apiKey: "sk-chat",
            balanceApiKey: "sk-management",
          },
        ],
      },
      {},
    );
    expect(state.providers[0].hasApiKey).toBe(true);
    expect(state.providers[0].hasBalanceApiKey).toBe(true);
    expect(JSON.stringify(state)).not.toMatch(/sk-chat|sk-management/);

    const resolved = await resolveOpenAIProvider({ providerId: "router", fallback: {} });
    expect(resolved.apiKey).toBe("sk-chat");
    expect(resolved.balanceApiKey).toBe("sk-management");
    globalThis.fetch = async (_url, options) => {
      expect(options.headers.Authorization).toBe("Bearer sk-management");
      return Response.json({ data: { total_credits: 10, total_usage: 2.5 } });
    };
    const balance = await providerBalance("router");
    expect(balance.status).toBe("ready");
    expect(balance.entries[0].total).toBe("7.5");
  });

  test("decimal money is combined without binary fractions", () => {
    const wallets = [
      {
        status: "ready",
        entries: [{ currency: "USD", total: "0.10", granted: "0", toppedUp: "0.10" }],
        available: true,
        checkedAt: 1,
        message: null,
      },
      {
        status: "ready",
        entries: [{ currency: "USD", total: "0.20", granted: "0", toppedUp: "0.20" }],
        available: true,
        checkedAt: 2,
        message: null,
      },
    ];
    expect(combineBalances(wallets)).toEqual([
      { currency: "USD", total: "0.30", granted: "0", toppedUp: "0.30" },
    ]);
  });
});

test("analytics wallet totals never add different currencies", () => {
  const totals = walletTotals([
    {
      provider: "a",
      label: "A",
      currency: "USD",
      points: [],
      total: 5,
      spent: 1.5,
      toppedUp: 0,
      checkedAt: 10,
    },
    {
      provider: "b",
      label: "B",
      currency: "USD",
      points: [],
      total: 7,
      spent: 2,
      toppedUp: 1,
      checkedAt: 20,
    },
    {
      provider: "c",
      label: "C",
      currency: "CNY",
      points: [],
      total: 110,
      spent: 10,
      toppedUp: 0,
      checkedAt: 30,
    },
  ]);
  expect(totals).toEqual([
    {
      currency: "USD",
      total: 12,
      unknown: 0,
      spent: 3.5,
      toppedUp: 1,
      wallets: 2,
      checkedAt: 20,
    },
    {
      currency: "CNY",
      total: 110,
      unknown: 0,
      spent: 10,
      toppedUp: 0,
      wallets: 1,
      checkedAt: 30,
    },
  ]);
});
