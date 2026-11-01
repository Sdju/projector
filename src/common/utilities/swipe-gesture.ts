/**
 * One-finger swipe recognition shared by mobile navigation and bottom sheets.
 *
 * A gesture belongs to one axis. The first deliberate move locks the axis, the other axis
 * rejects the gesture, and a long press never becomes a swipe. The binding never calls
 * `preventDefault` before the axis is locked, so taps, native scrolling and text selection keep
 * working until the gesture is clearly ours.
 */

export type SwipeAxis = "x" | "y";

/** Motion preferences are read at use time: the setting can change while the page is open. */
export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

export interface SwipePoint {
  x: number;
  y: number;
  time: number;
}

export interface SwipeMove {
  claimed: boolean;
  delta: number;
  dx: number;
  dy: number;
  velocity: number;
}

export interface SwipeProgress {
  axis: SwipeAxis;
  delta: number;
  dx: number;
  dy: number;
  velocity: number;
  event: TouchEvent;
}

export interface SwipeTrackerOptions {
  /** The gesture belongs to this axis; a deliberate move along the other one rejects it. */
  axis: SwipeAxis;
  /** Pixels before the axis is chosen. */
  slop?: number;
  /** The chosen axis must be this many times larger than the other one. */
  dominance?: number;
  /** A finger held longer than this before moving is a long press, not a swipe. */
  hold?: number;
}

const empty = (): SwipeMove => ({ claimed: false, delta: 0, dx: 0, dy: 0, velocity: 0 });

/** Pure state machine for tests and for the DOM binding below. */
export function createSwipeTracker(options: SwipeTrackerOptions) {
  const slop = options.slop ?? 8;
  const dominance = options.dominance ?? 1.15;
  const hold = options.hold ?? 700;
  let start: SwipePoint | undefined;
  let locked = false;
  let rejected = false;
  let last: SwipePoint | undefined;
  let previousDelta = 0;
  let velocity = 0;

  const reset = () => {
    start = undefined;
    locked = false;
    rejected = false;
    last = undefined;
    previousDelta = 0;
    velocity = 0;
  };
  const result = (dx: number, dy: number): SwipeMove => ({
    claimed: locked,
    delta: options.axis === "x" ? dx : dy,
    dx,
    dy,
    velocity,
  });

  function begin(point: SwipePoint) {
    reset();
    start = point;
    last = point;
  }
  function move(point: SwipePoint): SwipeMove {
    const origin = start;
    if (!origin || rejected) return empty();
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    if (!locked) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < slop) return empty();
      // Selection and context menus start with a hold; a swipe starts at once.
      if (point.time - origin.time > hold) {
        rejected = true;
        return empty();
      }
      const along = options.axis === "x" ? Math.abs(dx) : Math.abs(dy);
      const across = options.axis === "x" ? Math.abs(dy) : Math.abs(dx);
      if (along >= slop && along > across * dominance) {
        locked = true;
        previousDelta = options.axis === "x" ? dx : dy;
        velocity = previousDelta / Math.max(point.time - origin.time, 1);
        last = point;
        return result(dx, dy);
      }
      if (across >= slop && across >= along * dominance) rejected = true;
      return empty();
    }
    const delta = options.axis === "x" ? dx : dy;
    const elapsed = Math.max(point.time - (last?.time ?? origin.time), 1);
    // Smooth the release speed so one jittery sample does not decide the fling.
    velocity = 0.6 * ((delta - previousDelta) / elapsed) + 0.4 * velocity;
    previousDelta = delta;
    last = point;
    return result(dx, dy);
  }
  function end(point?: SwipePoint): SwipeMove {
    if (point && locked) move(point);
    const origin = start;
    const dx = origin ? (last?.x ?? origin.x) - origin.x : 0;
    const dy = origin ? (last?.y ?? origin.y) - origin.y : 0;
    const finish = result(dx, dy);
    reset();
    return finish;
  }
  function cancel() {
    reset();
  }
  return { begin, move, end, cancel };
}

/** A release is a navigation when it travelled far enough or was thrown in the same direction. */
export function swipeCommit(distance: number, velocity: number, threshold: number, fling = 0.45) {
  const direction = Math.sign(distance);
  if (!direction) return false;
  if (Math.abs(distance) >= threshold) return true;
  return (
    Math.abs(distance) >= 24 && Math.abs(velocity) >= fling && Math.sign(velocity) === direction
  );
}

/** Form controls, editors and explicit opt-outs keep the touch for themselves. */
export function swipeTargetIgnored(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, option, [contenteditable]:not([contenteditable='false']), [role='textbox'], [role='slider'], [data-swipe-ignore]",
    ),
  );
}

function scrollable(element: Element, axis: SwipeAxis): boolean {
  const style = getComputedStyle(element);
  const overflow = axis === "x" ? style.overflowX : style.overflowY;
  if (!["auto", "scroll", "overlay"].includes(overflow)) return false;
  return axis === "x"
    ? element.scrollWidth - element.clientWidth > 1
    : element.scrollHeight - element.clientHeight > 1;
}

/**
 * True when a scroll container between the finger and `boundary` can still move in the swipe
 * direction. Then the touch belongs to that container rather than to the gesture.
 */
export function scrollsInDirection(
  target: EventTarget | null,
  axis: SwipeAxis,
  direction: number,
  boundary: Element,
): boolean {
  if (!(target instanceof Element) || !direction) return false;
  let node: Element | null = target;
  while (node) {
    if (scrollable(node, axis)) {
      if (axis === "x") {
        const max = node.scrollWidth - node.clientWidth;
        if (direction < 0 ? node.scrollLeft < max - 1 : node.scrollLeft > 1) return true;
      } else {
        const max = node.scrollHeight - node.clientHeight;
        if (direction > 0 ? node.scrollTop > 1 : node.scrollTop < max - 1) return true;
      }
    }
    if (node === boundary) break;
    node = node.parentElement;
  }
  return false;
}

export interface SwipeGestureOptions {
  axis: SwipeAxis;
  enabled?: () => boolean;
  /** Explicit target policy on top of the default form-control opt-outs. */
  ignoreTarget?: (target: EventTarget | null) => boolean;
  /** Called after the axis is locked; false gives the touch back to the page. */
  canStart?: (event: TouchEvent, move: SwipeMove) => boolean;
  onStart?: (progress: SwipeProgress) => void;
  onMove?: (progress: SwipeProgress) => void;
  onEnd?: (progress: SwipeProgress) => void;
  onCancel?: () => void;
  slop?: number;
  dominance?: number;
  hold?: number;
}

/** Attach touch listeners to one element. Returns the cleanup function. */
export function bindSwipeGesture(element: HTMLElement, options: SwipeGestureOptions): () => void {
  const tracker = createSwipeTracker(options);
  let active = false;
  let claimed = false;
  let disposed = false;

  const pointOf = (touch: Touch, time: number): SwipePoint => ({
    x: touch.clientX,
    y: touch.clientY,
    time,
  });
  const progress = (move: SwipeMove, event: TouchEvent): SwipeProgress => ({
    axis: options.axis,
    delta: move.delta,
    dx: move.dx,
    dy: move.dy,
    velocity: move.velocity,
    event,
  });
  const stop = (cancel = false) => {
    const wasClaimed = claimed;
    active = false;
    claimed = false;
    tracker.cancel();
    if (cancel && wasClaimed) options.onCancel?.();
  };
  const onStart = (event: TouchEvent) => {
    if (disposed || !(options.enabled?.() ?? true)) return;
    if (event.touches.length !== 1) return stop(true);
    if (options.ignoreTarget?.(event.target) || swipeTargetIgnored(event.target)) return stop();
    tracker.begin(pointOf(event.touches[0], event.timeStamp));
    active = true;
    claimed = false;
  };
  const onMove = (event: TouchEvent) => {
    if (disposed || !active) return;
    if (event.touches.length !== 1 || !(options.enabled?.() ?? true)) return stop(true);
    // The browser already took the touch for scrolling: it is not ours to cancel anymore.
    if (!event.cancelable) return stop(true);
    const move = tracker.move(pointOf(event.touches[0], event.timeStamp));
    if (!move.claimed) return;
    if (!claimed) {
      if (options.canStart && !options.canStart(event, move)) return stop();
      claimed = true;
      options.onStart?.(progress(move, event));
    }
    event.preventDefault();
    options.onMove?.(progress(move, event));
  };
  const onEnd = (event: TouchEvent) => {
    if (!active) return;
    active = false;
    if (!claimed) {
      tracker.end();
      return;
    }
    claimed = false;
    if (event.cancelable) event.preventDefault();
    const touch = event.changedTouches[0];
    const move = tracker.end(touch ? pointOf(touch, event.timeStamp) : undefined);
    options.onEnd?.(progress(move, event));
  };
  const onCancel = () => stop(true);

  element.addEventListener("touchstart", onStart, { passive: true });
  element.addEventListener("touchmove", onMove, { passive: false });
  element.addEventListener("touchend", onEnd, { passive: false });
  element.addEventListener("touchcancel", onCancel, { passive: true });
  return () => {
    disposed = true;
    stop();
    element.removeEventListener("touchstart", onStart);
    element.removeEventListener("touchmove", onMove);
    element.removeEventListener("touchend", onEnd);
    element.removeEventListener("touchcancel", onCancel);
  };
}
