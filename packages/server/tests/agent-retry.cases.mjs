import { APICallError } from "ai";
import { describe, expect, it } from "vite-plus/test";
import { isRetryable, pause, retryDelay } from "../modules/agents/projector/projector-retry.ts";

const api = (statusCode, responseHeaders, message = "fail") =>
  new APICallError({
    message,
    url: "x",
    requestBodyValues: {},
    statusCode,
    responseHeaders,
  });

describe("provider retry", () => {
  it("retries rate limits, server errors and dropped connections", () => {
    expect(isRetryable(api(429))).toBe(true);
    expect(isRetryable(api(503))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  it("recognises a provider overload when it comes without a status", () => {
    expect(isRetryable(new Error("Upstream request failed: [overloaded] retry shortly"))).toBe(
      true,
    );
    expect(isRetryable(api(undefined, undefined, "Upstream request failed: overloaded"))).toBe(
      true,
    );
    expect(isRetryable(api(200, undefined, "Upstream request failed: overloaded"))).toBe(true);
    expect(isRetryable(new Error("bad request"))).toBe(false);
  });

  it("does not retry bad requests, keys or stops", () => {
    expect(isRetryable(api(400))).toBe(false);
    expect(isRetryable(api(401))).toBe(false);
    expect(isRetryable(Object.assign(new Error("x"), { name: "AbortError" }))).toBe(false);
    expect(isRetryable("boom")).toBe(false);
  });

  it("backs off exponentially, capped, and obeys Retry-After", () => {
    expect(retryDelay(1)).toBe(retryDelay(0) * 2);
    expect(retryDelay(20)).toBe(20_000);
    expect(retryDelay(0, api(429, { "retry-after": "5" }))).toBe(5000);
    expect(retryDelay(0, api(429, { "retry-after": "999" }))).toBe(20_000);
  });

  it("stops waiting when the turn is aborted", async () => {
    const controller = new AbortController();
    const waiting = pause(60_000, controller.signal);
    controller.abort();
    await waiting;
  });
});
