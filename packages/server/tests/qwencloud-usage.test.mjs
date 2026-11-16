import { expect, test } from "vite-plus/test";
import {
  parseQwenCloudUsage,
  readQwenCloudUsage,
  resetQwenCloudUsageCache,
} from "../modules/provider-qwencloud/index.ts";

const usage = {
  period: { from: "2026-11-01", to: "2026-11-30" },
  free_tier: [
    {
      model_id: "qwen3.8-max",
      quota: { total: "1000000", remaining: "250000", unit: "tokens", status: "active" },
    },
  ],
  coding_plan: { subscribed: true, plan: "pro" },
  token_plan: { totalCredits: 100, remainingCredits: 40 },
  pay_as_you_go: { total: { cost: "1.25", currency: "USD" } },
};

const billing = {
  period: { from: "2026-11-01", to: "2026-11-30" },
  currency: "USD",
  totals: { pretaxAmount: "1.00", tax: "0.25", aftertaxAmount: "1.25" },
  cycles: [],
};

const context = {
  id: "qwen",
  name: "QwenCloud",
  kind: "qwencloud",
  url: "https://ap-southeast-1.maas.qwencloudapi.com/compatible-mode/v1",
  apiKey: "sk-test",
  signal: AbortSignal.timeout(5000),
};

test("usage and billing JSON are normalized without pretending to be a wallet", () => {
  expect(parseQwenCloudUsage(usage, billing)).toStrictEqual({
    period: { from: "2026-11-01", to: "2026-11-30" },
    currency: "USD",
    spend: "1.25",
    quotas: [
      {
        modelId: "qwen3.8-max",
        remaining: "250000",
        total: "1000000",
        unit: "tokens",
        percent: 25,
        status: "active",
      },
    ],
    plan: "pro",
    credits: { total: 100, remaining: 40 },
  });
  expect(parseQwenCloudUsage(usage, null).spend).toBe("1.25");
  expect(parseQwenCloudUsage({}, {}).spend).toBe(null);
  expect(parseQwenCloudUsage({ pay_as_you_go: { total: { cost: "bad" } } }, {}).currency).toBe(
    null,
  );
});

test("a missing CLI is reported without leaking the key", async () => {
  resetQwenCloudUsageCache();
  const runner = async () => {
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };
  const result = await readQwenCloudUsage(context, runner);
  expect(result.status).toBe("unavailable");
  expect(result.message).toMatch(/не установлен/);
  expect(JSON.stringify(result)).not.toMatch(/sk-test/);
  resetQwenCloudUsageCache();
});
