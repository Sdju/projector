import { expect, test } from "vite-plus/test";
import { createSwipeTracker, swipeCommit } from "../common/utilities/swipe-gesture.ts";

const point = (x, y, time) => ({ x, y, time });

test("a tap and a move under the slop stay unclaimed", () => {
  const swipe = createSwipeTracker({ axis: "x" });
  swipe.begin(point(100, 100, 0));
  expect(swipe.move(point(103, 102, 16)).claimed).toBe(false);
  expect(swipe.end().claimed).toBe(false);
});

test("the first deliberate move locks one axis and reports the whole distance", () => {
  const swipe = createSwipeTracker({ axis: "x" });
  swipe.begin(point(100, 100, 0));
  const move = swipe.move(point(40, 104, 50));
  expect(move.claimed).toBe(true);
  expect(move.delta).toBe(-60);
  expect(move.dx).toBe(-60);
  expect(move.dy).toBe(4);
  expect(move.velocity).toBeLessThan(0);
});

test("a vertical move rejects a horizontal gesture for good", () => {
  const swipe = createSwipeTracker({ axis: "x" });
  swipe.begin(point(100, 100, 0));
  expect(swipe.move(point(102, 140, 40)).claimed).toBe(false);
  // A later horizontal move does not revive the rejected gesture.
  expect(swipe.move(point(10, 140, 80)).claimed).toBe(false);
  expect(swipe.end().claimed).toBe(false);
});

test("a long hold is a press, not a swipe", () => {
  const swipe = createSwipeTracker({ axis: "y", hold: 300 });
  swipe.begin(point(100, 100, 0));
  expect(swipe.move(point(100, 160, 400)).claimed).toBe(false);
  expect(swipe.move(point(100, 200, 450)).claimed).toBe(false);
});

test("release distance and velocity decide the commit in the swipe direction", () => {
  expect(swipeCommit(10, 0.9, 60)).toBe(false);
  expect(swipeCommit(70, 0, 60)).toBe(true);
  expect(swipeCommit(30, 0.8, 60)).toBe(true);
  expect(swipeCommit(30, -0.8, 60)).toBe(false);
  expect(swipeCommit(-70, 0, 60)).toBe(true);
  expect(swipeCommit(0, 1, 60)).toBe(false);
});
