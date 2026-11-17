import { expect, test } from "vite-plus/test";
import { quotaResumeTurn } from "../modules/agent-core/model/quota-resume.ts";

const assistant = (failureInfo, id = "a1") => ({
  id,
  role: "assistant",
  text: "",
  tools: [],
  failureInfo,
});

test("a quota with a future reset is a continuation target", () => {
  const now = Date.now();
  const turn = assistant({
    class: "usage_limit",
    message: "Достигнут лимит",
    code: "http_429",
    retryable: true,
    resetAt: now + 60_000,
  });
  expect(quotaResumeTurn([{ id: "u1", role: "user", text: "x", tools: [] }, turn], now)?.id).toBe(
    "a1",
  );
});

test("a passed reset is not a plan", () => {
  const now = Date.now();
  const turn = assistant({
    class: "usage_limit",
    message: "x",
    code: null,
    retryable: true,
    resetAt: now - 1,
  });
  expect(quotaResumeTurn([turn], now)).toBeUndefined();
});

test("only the last answer and only a quota failure count", () => {
  const now = Date.now();
  const quota = assistant(
    { class: "usage_limit", message: "x", code: null, retryable: true, resetAt: now + 1000 },
    "a1",
  );
  const other = assistant(
    { class: "provider_error", message: "x", code: null, retryable: true },
    "a2",
  );
  expect(quotaResumeTurn([quota, other], now)).toBeUndefined();
  expect(quotaResumeTurn([other, quota], now)?.id).toBe("a1");
  expect(quotaResumeTurn([quota], now)?.id).toBe("a1");
});
