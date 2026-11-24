import { afterEach, beforeEach, expect, test } from "vite-plus/test";
import {
  assertUsageNetworkContext,
  NETWORK_CONTEXT_URL,
  resetUsageNetworkContext,
} from "../modules/network/index.ts";

const previousFetch = globalThis.fetch;
let calls = 0;

function probe(body) {
  globalThis.fetch = async (url) => {
    expect(url).toBe(NETWORK_CONTEXT_URL);
    calls++;
    return Response.json(body);
  };
}

beforeEach(() => {
  calls = 0;
  resetUsageNetworkContext();
});

afterEach(() => {
  globalThis.fetch = previousFetch;
  resetUsageNetworkContext();
});

test("a successful probe is cached and shared by concurrent callers", async () => {
  probe({ success: true, is_eu: true });
  await Promise.all([assertUsageNetworkContext(1000), assertUsageNetworkContext(1000)]);
  await assertUsageNetworkContext(1000);
  expect(calls).toBe(1);
});

test("a failed probe is not cached and is retried", async () => {
  probe({ success: false, is_eu: true });
  await expect(assertUsageNetworkContext(1000)).rejects.toThrow(/сетевой контекст/);
  await expect(assertUsageNetworkContext(1000)).rejects.toThrow(/сетевой контекст/);
  expect(calls).toBe(2);
});

test("the USA passes while an unlisted country is rejected", async () => {
  probe({ success: true, is_eu: false, country_code: "US" });
  await expect(assertUsageNetworkContext(1000)).resolves.toBeUndefined();
  resetUsageNetworkContext();
  probe({ success: true, is_eu: false, country_code: "GB" });
  await expect(assertUsageNetworkContext(1000)).rejects.toThrow(/сетевой контекст/);
});
