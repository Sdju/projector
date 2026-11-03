import { onScopeDispose, readonly, ref } from "vue";

type FinishReason = "up" | "cancel" | "lostcapture" | "stop" | "dispose";
type StyleValue = { value: string; priority: string };
type BodyLock = { cursor: StyleValue; selection: StyleValue; leases: { cursor: string }[] };
const bodyLocks = new WeakMap<Document, BodyLock>();

/** Nested drags release only their own lease and preserve pre-existing inline styles. */
function lockBody(document: Document, cursor: string) {
  const style = document.body.style;
  const saved = (property: string): StyleValue => ({
    value: style.getPropertyValue(property),
    priority: style.getPropertyPriority(property),
  });
  const lock = bodyLocks.get(document) ?? {
    cursor: saved("cursor"),
    selection: saved("user-select"),
    leases: [],
  };
  const lease = { cursor };
  lock.leases.push(lease);
  bodyLocks.set(document, lock);
  style.setProperty("cursor", cursor);
  style.setProperty("user-select", "none");
  return () => {
    lock.leases.splice(lock.leases.indexOf(lease), 1);
    const last = lock.leases.at(-1);
    if (last) style.setProperty("cursor", last.cursor);
    else {
      style.setProperty("cursor", lock.cursor.value, lock.cursor.priority);
      style.setProperty("user-select", lock.selection.value, lock.selection.priority);
      bodyLocks.delete(document);
    }
  };
}

/** Owns pointer capture only. Coordinates, clamp, rollback and keyboard policy stay local. */
export function usePointerDrag<T>(options: {
  start: (event: PointerEvent) => T | undefined;
  move: (event: PointerEvent, state: T) => void;
  finish?: (reason: FinishReason, state: T, event?: PointerEvent) => void;
  cursor?: () => string;
}) {
  const dragging = ref(false);
  let active: { id: number; target: HTMLElement; state: T; unlock?: () => void } | undefined;
  function stop(reason: FinishReason = "stop", event?: PointerEvent) {
    const current = active;
    if (!current) return;
    active = undefined;
    dragging.value = false;
    const target = current.target;
    target.removeEventListener("pointermove", move);
    target.removeEventListener("pointerup", up);
    target.removeEventListener("pointercancel", cancel);
    target.removeEventListener("lostpointercapture", lost);
    current.unlock?.();
    if (target.hasPointerCapture(current.id)) target.releasePointerCapture(current.id);
    options.finish?.(reason, current.state, event);
  }
  const move = (event: PointerEvent) => {
    if (active?.id === event.pointerId) options.move(event, active.state);
  };
  const up = (event: PointerEvent) => {
    if (active?.id === event.pointerId) stop("up", event);
  };
  const cancel = (event: PointerEvent) => {
    if (active?.id === event.pointerId) stop("cancel", event);
  };
  const lost = (event: PointerEvent) => {
    if (active?.id === event.pointerId) stop("lostcapture", event);
  };
  function start(event: PointerEvent) {
    if (event.button !== 0 || active) return;
    const state = options.start(event);
    if (state === undefined) return;
    const target = event.currentTarget as HTMLElement;
    event.preventDefault();
    target.focus();
    target.setPointerCapture(event.pointerId);
    active = { id: event.pointerId, target, state };
    if (options.cursor) active.unlock = lockBody(target.ownerDocument, options.cursor());
    dragging.value = true;
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", cancel);
    target.addEventListener("lostpointercapture", lost);
  }
  onScopeDispose(() => stop("dispose"));
  return { dragging: readonly(dragging), start, stop };
}
