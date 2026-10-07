import { expect, onTestFinished, test, vi } from "vite-plus/test";
import { setImmediate } from "node:timers/promises";
import { createRenderer } from "vue";
import { createUsageCache } from "../server/modules/agents-integration/_/usage-cache.ts";
import { useUsagePolling } from "../src/modules/agents-integration/_/use-usage-polling.ts";
import {
  USAGE_PERIOD_SECONDS,
  usagePaceTone,
} from "../src/modules/agents-integration/_/usage-pace.ts";

test("usage cache survives loader replacement during a pending HMR request", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: 100000 });
  const state = {};
  let finish;
  const first = createUsageCache(
    state,
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = first();
  let calls = 0;
  const replacement = createUsageCache(state, async () => {
    calls++;
    return { checkedAt: Date.now() };
  });
  expect(replacement()).toBe(pending);
  await Promise.resolve();
  const response = { checkedAt: Date.now() };
  finish(response);
  expect(await pending).toBe(response);
  expect(await replacement()).toBe(response);
  expect(calls).toBe(0);
  vi.advanceTimersByTime(60000);
  await replacement();
  expect(calls).toBe(1);
});

test("failed cache loads release pending state so a later request can recover", async () => {
  const state = {};
  const broken = createUsageCache(state, async () => {
    throw new Error("offline");
  });
  await expect(broken()).rejects.toThrow(/offline/);
  expect(state.pending).toBe(undefined);
  const recovered = createUsageCache(state, async () => ({ checkedAt: Date.now() }));
  expect((await recovered()).checkedAt).toBeTruthy();
});

function mountPolling(options) {
  const document = new EventTarget();
  document.hidden = false;
  const original = globalThis.document;
  globalThis.document = document;
  const renderer = createRenderer({
    createComment: () => ({}),
    createText: () => ({}),
    createElement: () => ({}),
    insert() {},
    remove() {},
    setText() {},
    setElementText() {},
    patchProp() {},
    parentNode: () => null,
    nextSibling: () => null,
  });
  let model;
  const app = renderer.createApp({
    setup() {
      model = useUsagePolling("/api/fixture/usage", options);
      return () => null;
    },
  });
  app.mount({});
  onTestFinished(() => {
    app.unmount();
    if (original === undefined) delete globalThis.document;
    else globalThis.document = original;
  });
  return { model, document, app };
}

test("polling respects server retry time, hidden pages and unmount cleanup", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"], now: 100000 });
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return Response.json({ nextCheckAt: Date.now() + 3600000 });
  });
  const { model, document, app } = mountPolling({
    intervalMs: 300000,
    nextCheckAt: (value) => value.nextCheckAt,
  });
  await setImmediate();
  expect(calls).toBe(1);
  expect(model.failed.value).toBe(false);
  vi.advanceTimersByTime(3599999);
  await setImmediate();
  expect(calls).toBe(1);
  document.hidden = true;
  vi.advanceTimersByTime(1);
  await setImmediate();
  expect(calls).toBe(1);
  document.hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
  await setImmediate();
  expect(calls).toBe(2);
  app.unmount();
  document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(3600000);
  await setImmediate();
  expect(calls).toBe(2);
});

test("polling deduplicates in-flight refreshes and aborts on unmount", async () => {
  let calls = 0;
  let signal;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, options) => {
    calls++;
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  });
  const { model, document, app } = mountPolling();
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
  expect(calls).toBe(1);
  app.unmount();
  await setImmediate();
  expect(signal.aborted).toBe(true);
  expect(model.failed.value).toBe(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(calls).toBe(1);
});

test("HTTP polling errors retain last usage and recover on the next interval", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  let calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    return calls === 2 ? new Response(null, { status: 503 }) : Response.json({ sequence: calls });
  });
  const { model } = mountPolling();
  await setImmediate();
  expect(model.usage.value.sequence).toBe(1);
  vi.advanceTimersByTime(60000);
  await setImmediate();
  expect(model.failed.value).toBe(true);
  expect(model.usage.value.sequence).toBe(1);
  vi.advanceTimersByTime(60000);
  await setImmediate();
  expect(model.failed.value).toBe(false);
  expect(model.usage.value.sequence).toBe(3);
});

test("usage pace tones compare spent percent to elapsed fraction of the cycle", () => {
  const week = USAGE_PERIOD_SECONDS.week;
  const month = USAGE_PERIOD_SECONDS.month;
  const now = Date.parse("2026-10-05T12:00:00Z");
  const left = (seconds) => Math.floor(now / 1000) + seconds;

  // Mid-week: expected used ≈ 50%.
  expect(usagePaceTone(50, left(week / 2), week, now)).toBe("normal");
  expect(usagePaceTone(30, left(week / 2), week, now)).toBe("spare");
  expect(usagePaceTone(65, left(week / 2), week, now)).toBe("hot");
  expect(usagePaceTone(80, left(week / 2), week, now)).toBe("over");

  // Three days left in a week (~57% elapsed → expected ≈ 57%).
  expect(usagePaceTone(35, left(3 * 86400), week, now)).toBe("spare");
  expect(usagePaceTone(60, left(3 * 86400), week, now)).toBe("normal");
  expect(usagePaceTone(75, left(3 * 86400), week, now)).toBe("hot");

  // Monthly Cursor/OpenCode: fifteen days left of thirty.
  expect(usagePaceTone(20, left(15 * 86400), month, now)).toBe("spare");
  expect(usagePaceTone(50, left(15 * 86400), month, now)).toBe("normal");
  expect(usagePaceTone(68, left(15 * 86400), month, now)).toBe("hot");
  expect(usagePaceTone(80, left(15 * 86400), month, now)).toBe("over");

  expect(usagePaceTone(10, left(week), week, now, true)).toBe("over");
  expect(usagePaceTone(100, left(week / 2), week, now)).toBe("over");
  expect(usagePaceTone(40, null, week, now)).toBe(null);
  expect(usagePaceTone(40, left(week / 2), 0, now)).toBe(null);
});
