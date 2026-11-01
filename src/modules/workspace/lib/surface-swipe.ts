import { onScopeDispose, watch, type Ref } from "vue";
import {
  bindSwipeGesture,
  prefersReducedMotion,
  scrollsInDirection,
  swipeCommit,
  type SwipeProgress,
} from "../../../common/utilities/swipe-gesture.ts";
import type { MobileSurface } from "./mobile-surfaces.ts";

const spring = "cubic-bezier(.2, .8, .2, 1)";

/**
 * Horizontal swipe between the mobile work surfaces. The active page follows the finger with
 * resistance at the ends; releasing past the threshold hands the change to the existing surface
 * transitions, so a swipe and a tap on the bottom pill end in the same place.
 */
export function useSurfaceSwipe(options: {
  workspace: Ref<HTMLElement | undefined>;
  mobile: Ref<boolean>;
  surface: Ref<MobileSurface>;
  terminals: () => boolean;
  /** The same command the bottom pill uses, so swipes stay in the IDE command registry. */
  show: (surface: MobileSurface) => void;
}) {
  let unbind: (() => void) | undefined;
  let page: HTMLElement | undefined;
  let settle: Animation | undefined;

  const order = () =>
    ["files", "editor", ...(options.terminals() ? (["terminal"] as const) : [])] as MobileSurface[];
  const neighbour = (direction: -1 | 1) => {
    const list = order();
    const index = list.indexOf(options.surface.value);
    return list[index + direction];
  };
  const pageOf = () => {
    const root = options.workspace.value;
    if (!root) return undefined;
    return (
      (options.surface.value === "files"
        ? root.querySelector<HTMLElement>(".sidebar")
        : root.querySelector<HTMLElement>(".dock-pane")) ?? undefined
    );
  };
  const threshold = () =>
    Math.min(112, Math.max(48, (options.workspace.value?.clientWidth ?? 360) * 0.2));
  const clear = (element: HTMLElement) => {
    settle?.cancel();
    settle = undefined;
    element.style.transform = "";
    element.style.transition = "";
    element.style.willChange = "";
  };
  const back = (element: HTMLElement | undefined, from: string) => {
    if (!element) return;
    if (!from || prefersReducedMotion() || typeof element.animate !== "function")
      return clear(element);
    settle?.cancel();
    settle = element.animate([{ transform: from }, { transform: "translate3d(0, 0, 0)" }], {
      duration: 180,
      easing: spring,
    });
    settle.onfinish = () => {
      settle = undefined;
      clear(element);
    };
  };
  const start = () => {
    settle?.cancel();
    settle = undefined;
    page = pageOf();
    if (!page) return;
    page.style.transform = "";
    page.style.transition = "none";
    page.style.willChange = "transform";
  };
  const move = (progress: SwipeProgress) => {
    if (!page) return;
    const available = Boolean(neighbour(progress.delta < 0 ? 1 : -1));
    const factor = available ? 0.58 : 0.16;
    const width = options.workspace.value?.clientWidth ?? 360;
    const limit = Math.min(120, Math.max(48, width * 0.3));
    const offset = Math.max(-limit, Math.min(limit, progress.delta * factor));
    page.style.transform = `translate3d(${offset}px, 0, 0)`;
  };
  const end = (progress: SwipeProgress) => {
    const current = page;
    page = undefined;
    if (!current) return;
    const direction = progress.delta < 0 ? 1 : -1;
    const target = neighbour(direction);
    if (swipeCommit(progress.delta, progress.velocity, threshold()) && target) {
      // The destination has its own transition; do not leave the old page half-way out.
      clear(current);
      options.show(target);
      return;
    }
    back(current, current.style.transform);
  };
  const cancel = () => {
    const current = page;
    page = undefined;
    if (current) back(current, current.style.transform);
  };

  const attach = () => {
    unbind?.();
    unbind = undefined;
    page = undefined;
    const root = options.workspace.value;
    if (!root) return;
    unbind = bindSwipeGesture(root, {
      axis: "x",
      enabled: () => options.mobile.value,
      canStart: (event, gesture) =>
        Boolean(pageOf()) && !scrollsInDirection(event.target, "x", Math.sign(gesture.delta), root),
      onStart: start,
      onMove: move,
      onEnd: end,
      onCancel: cancel,
    });
  };

  watch(options.workspace, attach, { immediate: true, flush: "post" });
  watch(options.mobile, (compact) => {
    if (!compact) {
      settle?.cancel();
      settle = undefined;
      if (page) clear(page);
      page = undefined;
    }
  });
  const dispose = () => {
    unbind?.();
    unbind = undefined;
    settle?.cancel();
    settle = undefined;
    if (page) clear(page);
    page = undefined;
  };
  onScopeDispose(dispose);
  return dispose;
}
