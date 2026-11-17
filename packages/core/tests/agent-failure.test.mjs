import { describe, expect, it } from "vite-plus/test";
import {
  failureFromStatus,
  failureFromText,
  failureResetFromText,
  failureRetryable,
  failureTitle,
  sanitizeFailureText,
} from "../modules/agent-failure/index.ts";

describe("failure text", () => {
  it("removes credentials, query strings and control characters", () => {
    const text = sanitizeFailureText(
      "\u0000Bad gateway https://user:pass@example.com/api?token=1#x Bearer abc.def sk-1234567890abcdefgh",
    );
    expect(text).not.toContain("user:pass");
    expect(text).not.toContain("token=1");
    expect(text).not.toContain("abc.def");
    expect(text).not.toContain("sk-1234567890");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("\u0000");
  });

  it("removes values of secret-looking keys", () => {
    const text = sanitizeFailureText('{"api_key":"secret-value","password": "hunter2", "ok":1}');
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("hunter2");
    expect(text).toContain('"ok":1');
  });

  it("bounds the text without splitting a surrogate pair", () => {
    const text = sanitizeFailureText("a" + "😀".repeat(3000), 10);
    expect(text.length).toBeLessThanOrEqual(10);
    expect(text.endsWith("…")).toBe(true);
    expect(text).not.toMatch(/[\ud800-\udbff]$/);
  });
});

describe("failure class", () => {
  it.each([
    [429, "usage_limit"],
    [401, "permission_error"],
    [403, "permission_error"],
    [413, "validation_error"],
    [500, "provider_error"],
    [503, "provider_error"],
    [200, undefined],
    [undefined, undefined],
  ])("status %s is %s", (status, expected) => {
    expect(failureFromStatus(status)).toBe(expected);
  });

  it("reads the provider's words when there is no status", () => {
    expect(failureFromText("You have hit your usage limit. Resets in 3h")).toBe("usage_limit");
    expect(failureFromText("fetch failed")).toBe("transport_error");
    expect(failureFromText("401 Unauthorized: invalid api key")).toBe("permission_error");
    expect(failureFromText("prompt is too long for the context window")).toBe("validation_error");
    expect(failureFromText("something odd happened")).toBe("unknown");
  });

  it("prefers a quota phrase over a transport phrase in the same message", () => {
    expect(failureFromText("rate limit reached, stream closed")).toBe("usage_limit");
  });
});

describe("quota reset", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");

  it("parses the provider's duration", () => {
    expect(failureResetFromText("resets after 1h 2m", now)).toBe(now + 3_720_000);
    expect(failureResetFromText("reset in 30s", now)).toBe(now + 30_000);
  });

  it("parses an absolute reset time", () => {
    expect(failureResetFromText("resets at 2026-01-02T03:04:05Z", now)).toBe(
      Date.parse("2026-01-02T03:04:05Z"),
    );
  });

  it("returns nothing when the provider said nothing", () => {
    expect(failureResetFromText("usage limit reached", now)).toBeUndefined();
  });
});

describe("presentation", () => {
  const failure = (patch = {}) => ({
    class: "provider_error",
    message: "x",
    code: null,
    retryable: null,
    ...patch,
  });

  it("labels quota differently from a failure", () => {
    expect(failureTitle(failure({ class: "usage_limit" }))).toBe("Достигнут лимит");
    expect(failureTitle(failure())).toBe("Ошибка агента");
  });

  it("retries transport and provider errors but not a rejected request", () => {
    expect(failureRetryable(failure({ class: "transport_error" }))).toBe(true);
    expect(failureRetryable(failure({ class: "validation_error" }))).toBe(false);
    expect(failureRetryable(failure({ retryable: true, class: "validation_error" }))).toBe(true);
    expect(failureRetryable(failure({ retryable: false, class: "provider_error" }))).toBe(false);
  });
});
