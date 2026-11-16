import { expect, test } from "vite-plus/test";
import { visibleAppHeight, viewportInset } from "../common/utilities/app-viewport.ts";

test("without a keyboard the visible height is the whole layout viewport", () => {
  expect(visibleAppHeight({ height: 844, offsetTop: 0 }, 844)).toBe(844);
  expect(viewportInset({ height: 844 }, 844)).toBe(0);
});

test("the soft keyboard takes its height away from the layout viewport", () => {
  expect(visibleAppHeight({ height: 508, offsetTop: 0 }, 844)).toBe(508);
  expect(viewportInset({ height: 508 }, 844)).toBe(336);
});

test("a visual viewport panned down to the field ends at the same visible bottom edge", () => {
  // Safari reveals a focused field near the bottom by panning the visual viewport down.
  expect(visibleAppHeight({ height: 488, offsetTop: 20 }, 844)).toBe(508);
  expect(viewportInset({ height: 488, offsetTop: 20 }, 844)).toBe(336);
});

test("browser chrome stays below the keyboard threshold", () => {
  expect(viewportInset({ height: 780 }, 844)).toBe(64);
  expect(viewportInset({ height: 780 }, 844)).toBeLessThan(120);
});

test("a hidden or zoomed visual viewport never exceeds the layout viewport", () => {
  expect(visibleAppHeight({ height: 0, offsetTop: 0 }, 844)).toBe(0);
  expect(visibleAppHeight({ height: 900, offsetTop: 0 }, 844)).toBe(844);
});
