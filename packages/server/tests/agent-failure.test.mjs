import { APICallError } from "ai";
import { describe, expect, it } from "vite-plus/test";
import {
  failureFromAcp,
  failureFromClaudeResult,
  failureFromError,
  makeFailure,
} from "../modules/agent/failure.ts";
import { isAgentFailure } from "@ai-projector/core/modules/agent-failure/index.ts";

const api = (statusCode, headers, message = "provider said no") =>
  new APICallError({
    message,
    url: "https://api.example.com/v1/chat?key=secret",
    requestBodyValues: {},
    statusCode,
    responseHeaders: headers,
  });

describe("AI SDK failures", () => {
  it("keeps the status, the quota reset and retry advice", () => {
    const failure = failureFromError(api(429, { "retry-after": "30" }));
    expect(failure.class).toBe("usage_limit");
    expect(failure.code).toBe("http_429");
    expect(failure.retryable).toBe(true);
    expect(failure.resetAt).toBeGreaterThan(Date.now() + 20_000);
  });

  it("does not retry a rejected request or a key", () => {
    expect(failureFromError(api(400))).toMatchObject({
      class: "validation_error",
      retryable: false,
    });
    expect(failureFromError(api(401))).toMatchObject({
      class: "permission_error",
      retryable: false,
    });
  });

  it("treats a server error as retryable", () => {
    expect(failureFromError(api(503))).toMatchObject({ class: "provider_error", retryable: true });
  });

  it("removes the query from the message", () => {
    expect(failureFromError(api(500)).message).not.toContain("key=secret");
  });
});

describe("network failures", () => {
  it("recognises a dropped connection by its code", () => {
    const failure = failureFromError(
      Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }),
    );
    expect(failure.class).toBe("transport_error");
    expect(failure.retryable).toBe(true);
  });
});

describe("ACP failures", () => {
  it("keeps an exhausted step budget distinct from a crash", () => {
    expect(failureFromAcp(undefined, "max_turn_requests")).toMatchObject({
      class: "provider_error",
      code: "stop_max_turn_requests",
      retryable: false,
    });
  });

  it("reads an authentication error by its JSON-RPC code", () => {
    expect(failureFromAcp({ code: 401, message: "sign in first" })).toMatchObject({
      class: "permission_error",
      retryable: false,
    });
  });

  it("reopens a dead connection, not a rejected request", () => {
    expect(failureFromAcp({ fatal: true, message: "socket closed" })).toMatchObject({
      class: "transport_error",
      retryable: true,
    });
  });
});

describe("Claude Code results", () => {
  it("maps a usage limit and its reset", () => {
    const failure = failureFromClaudeResult({
      subtype: "success",
      is_error: true,
      api_error_status: 429,
      result: "API Error: 429 Too many requests (reset after 30s)",
    });
    expect(failure.class).toBe("usage_limit");
    expect(failure.retryable).toBe(true);
    expect(failure.resetAt).toBeGreaterThan(Date.now() + 20_000);
  });

  it("maps an overload and a turn limit", () => {
    expect(
      failureFromClaudeResult({ subtype: "success", is_error: true, api_error_status: 529 }),
    ).toMatchObject({ class: "provider_error", retryable: true });
    expect(failureFromClaudeResult({ subtype: "error_max_turns" })).toMatchObject({
      class: "validation_error",
      retryable: false,
    });
  });
});

describe("the failure shape", () => {
  it("always has a safe non-empty message", () => {
    const failure = makeFailure({ message: "   " });
    expect(failure.message).toBe("Ошибка агента");
    expect(isAgentFailure(failure)).toBe(true);
  });

  it("rejects a broken object", () => {
    expect(isAgentFailure({ class: "usage_limit", message: "x" })).toBe(false);
    expect(isAgentFailure({ class: "made-up", message: "x", code: null, retryable: null })).toBe(
      false,
    );
  });
});
