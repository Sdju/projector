import type { Terminal } from "@xterm/xterm";

/** Legacy wheelDeltaY units of one mouse-wheel notch. */
const WHEEL_NOTCH = 120;
/** Pixels a finger must travel vertically before a touch becomes a scroll gesture and stops being a tap. */
const SLOP = 6;
/** Fling starts above this release speed (px/ms) and ends below `STOP_SPEED`. */
const FLING_SPEED = 0.3;
const STOP_SPEED = 0.02;
/** Per-frame (16 ms) velocity decay of a fling. */
const FRICTION = 0.95;

export type TouchScrollEmit = (deltaY: number, clientX: number, clientY: number) => void;

/**
 * One-finger vertical drag becomes wheel input, so xterm itself decides what it means: scrollback in the
 * normal buffer, arrow keys on the alternate screen and mouse-wheel reports for mouse-tracking programs.
 * Taps are left alone and keep focusing the terminal.
 */
export function bindTerminalTouchScroll(element: HTMLElement, emit: TouchScrollEmit): () => void {
  let start: { x: number; y: number } | undefined;
  let last = { x: 0, y: 0, time: 0 };
  let velocity = 0;
  let scrolling = false;
  let frame = 0;

  const stopFling = () => {
    cancelAnimationFrame(frame);
    frame = 0;
  };
  const fling = (previous: number) => {
    frame = requestAnimationFrame((now) => {
      const elapsed = Math.min(now - previous, 50);
      velocity *= FRICTION ** (elapsed / 16);
      if (Math.abs(velocity) < STOP_SPEED) return stopFling();
      emit(-velocity * elapsed, last.x, last.y);
      fling(now);
    });
  };

  const onStart = (event: TouchEvent) => {
    stopFling();
    scrolling = false;
    if (event.touches.length !== 1) {
      start = undefined;
      return;
    }
    const { clientX: x, clientY: y } = event.touches[0];
    start = { x, y };
    last = { x, y, time: event.timeStamp };
    velocity = 0;
  };
  const onMove = (event: TouchEvent) => {
    if (!start || event.touches.length !== 1) {
      start = undefined;
      return;
    }
    const { clientX: x, clientY: y } = event.touches[0];
    if (!scrolling) {
      const dy = y - start.y;
      const dx = x - start.x;
      if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
      // A horizontal swipe is not ours: leave it to the page (tabs, panels).
      if (Math.abs(dx) > Math.abs(dy)) {
        start = undefined;
        return;
      }
      scrolling = true;
    }
    event.preventDefault();
    const elapsed = Math.max(event.timeStamp - last.time, 1);
    const delta = y - last.y;
    // Smooth the speed so one jittery sample does not decide the fling.
    velocity = 0.6 * (delta / elapsed) + 0.4 * velocity;
    last = { x, y, time: event.timeStamp };
    if (delta) emit(-delta, x, y);
  };
  const onEnd = (event: TouchEvent) => {
    if (!scrolling) {
      start = undefined;
      return;
    }
    // Do not turn the end of a scroll into a click that focuses the terminal and opens the keyboard.
    if (event.cancelable) event.preventDefault();
    start = undefined;
    scrolling = false;
    if (Math.abs(velocity) >= FLING_SPEED && event.timeStamp - last.time < 80)
      fling(performance.now());
  };
  const onCancel = () => {
    start = undefined;
    scrolling = false;
    stopFling();
  };

  element.addEventListener("touchstart", onStart, { passive: true });
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd, { passive: false });
  element.addEventListener("touchcancel", onCancel, { passive: true });
  return () => {
    stopFling();
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onCancel);
  };
}

/**
 * Apply a drag to xterm. Scrollback is scrolled by whole rows through the public API; on the alternate screen
 * and under mouse tracking each dragged row becomes one wheel notch for xterm's own wheel handling
 * (an arrow key, or a wheel report for programs that track the mouse).
 */
export function terminalScroller(terminal: Terminal): TouchScrollEmit {
  let remainder = 0;
  return (deltaY, clientX, clientY) => {
    const screen = terminal.element?.querySelector(".xterm-screen");
    if (!screen) return;
    remainder += (deltaY * terminal.rows) / screen.getBoundingClientRect().height;
    const lines = Math.trunc(remainder);
    remainder -= lines;
    if (!lines) return;
    if (terminal.buffer.active.type === "normal" && terminal.modes.mouseTrackingMode === "none")
      return terminal.scrollLines(lines);
    for (let row = 0; row < Math.abs(lines); row++) {
      const event = new WheelEvent("wheel", {
        deltaY: Math.sign(lines),
        deltaMode: WheelEvent.DOM_DELTA_LINE,
        clientX,
        clientY,
        bubbles: true,
        cancelable: true,
      });
      // xterm reads the legacy wheelDeltaY, which Chrome leaves unsigned on constructed events.
      Object.defineProperty(event, "wheelDeltaY", { value: -Math.sign(lines) * WHEEL_NOTCH });
      screen.dispatchEvent(event);
    }
  };
}
