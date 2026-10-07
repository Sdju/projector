import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { bindTerminalTouchScroll } from "../src/modules/terminal/lib/touch-scroll.ts";

let frames;
let clock;
beforeEach(() => {
  frames = new Map();
  clock = 0;
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback) => {
    frames.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (handle) => frames.delete(handle));
  vi.spyOn(performance, "now").mockImplementation(() => clock);
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const element = new EventTarget();
  const emitted = [];
  const unbind = bindTerminalTouchScroll(element, (deltaY, x, y) => emitted.push([deltaY, x, y]));
  function touch(type, points, at) {
    clock = at;
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, "touches", {
      value: points.map(([x, y]) => ({ clientX: x, clientY: y })),
    });
    Object.defineProperty(event, "timeStamp", { value: at });
    element.dispatchEvent(event);
    return event;
  }
  function runFrames(step, count) {
    for (let index = 0; index < count && frames.size; index++) {
      clock += step;
      const [handle, callback] = [...frames][0];
      frames.delete(handle);
      callback(clock);
    }
  }
  return { emitted, touch, runFrames, unbind };
}

test("a tap is left alone so it still focuses the terminal", () => {
  const { emitted, touch } = setup();
  touch("touchstart", [[100, 100]], 0);
  expect(touch("touchmove", [[102, 103]], 20).defaultPrevented).toBe(false);
  expect(touch("touchend", [], 40).defaultPrevented).toBe(false);
  expect(emitted).toStrictEqual([]);
});

test("a vertical drag scrolls with the finger, takes over the page and swallows the click", () => {
  const { emitted, touch } = setup();
  touch("touchstart", [[100, 100]], 0);
  const move = touch("touchmove", [[100, 130]], 50);
  expect(move.defaultPrevented).toBe(true);
  // The first move reports the whole distance, because the finger already travelled it.
  expect(emitted).toStrictEqual([[-30, 100, 130]]);
  touch("touchmove", [[101, 120]], 100);
  expect(emitted.at(-1)).toStrictEqual([10, 101, 120]);
  expect(touch("touchend", [], 400).defaultPrevented).toBe(true);
});

test("horizontal swipes and multi-finger gestures belong to the page", () => {
  const { emitted, touch } = setup();
  touch("touchstart", [[100, 100]], 0);
  expect(touch("touchmove", [[150, 105]], 20).defaultPrevented).toBe(false);
  expect(touch("touchmove", [[150, 200]], 40).defaultPrevented).toBe(false);
  touch("touchend", [], 60);
  touch(
    "touchstart",
    [
      [100, 100],
      [200, 100],
    ],
    100,
  );
  expect(
    touch(
      "touchmove",
      [
        [100, 160],
        [200, 160],
      ],
      120,
    ).defaultPrevented,
  ).toBe(false);
  expect(emitted).toStrictEqual([]);
});

test("a quick release flings with decaying speed until it stops, and a new touch stops it", () => {
  const { emitted, touch, runFrames } = setup();
  touch("touchstart", [[100, 400]], 0);
  for (let step = 1; step <= 6; step++) touch("touchmove", [[100, 400 - step * 20]], step * 16);
  touch("touchend", [], 100);
  const dragged = emitted.length;
  runFrames(16, 400);
  const flung = emitted.slice(dragged).map(([delta]) => delta);
  expect(flung.length).toBeGreaterThan(5);
  expect(flung.every((delta) => delta > 0)).toBe(true);
  expect(flung.at(-1)).toBeLessThan(flung[0]);
  expect(frames.size).toBe(0);

  touch("touchstart", [[100, 400]], 1000);
  for (let step = 1; step <= 6; step++)
    touch("touchmove", [[100, 400 - step * 20]], 1000 + step * 16);
  touch("touchend", [], 1100);
  expect(frames.size).toBe(1);
  touch("touchstart", [[100, 300]], 1200);
  expect(frames.size).toBe(0);
});

test("a slow release does not fling, and unbinding detaches every listener", () => {
  const { emitted, touch, unbind } = setup();
  touch("touchstart", [[100, 100]], 0);
  touch("touchmove", [[100, 140]], 300);
  touch("touchend", [], 900);
  expect(frames.size).toBe(0);
  unbind();
  const count = emitted.length;
  touch("touchstart", [[100, 100]], 1000);
  touch("touchmove", [[100, 200]], 1020);
  expect(emitted.length).toBe(count);
});
