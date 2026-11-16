import { afterEach, expect, test, vi } from "vite-plus/test";
import { createStreamSaver } from "../modules/agent-core/model/stream-save.ts";

afterEach(() => vi.useRealTimers());

const text = (value) => ({ event: "text", data: { text: value } });

test("streamed text is saved in batches instead of on every chunk", () => {
  vi.useFakeTimers();
  let saves = 0;
  const saver = createStreamSaver(() => saves++);

  saver.event(text("a"), false);
  saver.event(text("b"), false);
  expect(saves).toBe(0);

  vi.advanceTimersByTime(999);
  expect(saves).toBe(0);
  vi.advanceTimersByTime(1);
  expect(saves).toBe(1);
});

test("a structural event saves at once and cancels the pending batch", () => {
  vi.useFakeTimers();
  let saves = 0;
  const saver = createStreamSaver(() => saves++);

  saver.event(text("a"), false);
  saver.event({ event: "run", data: { id: "r1" } }, true);
  expect(saves).toBe(1);

  vi.advanceTimersByTime(5_000);
  expect(saves).toBe(1);
});

test("stopping the answer drops a batch that has not fired yet", () => {
  vi.useFakeTimers();
  let saves = 0;
  const saver = createStreamSaver(() => saves++);

  saver.event(text("a"), false);
  saver.stop();
  vi.advanceTimersByTime(5_000);
  expect(saves).toBe(0);
});
