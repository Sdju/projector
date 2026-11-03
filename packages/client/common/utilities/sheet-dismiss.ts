import { onBeforeUnmount, ref, watch, type Ref } from "vue";
import {
  bindSwipeGesture,
  prefersReducedMotion,
  scrollsInDirection,
  swipeTargetIgnored,
  type SwipeProgress,
} from "./swipe-gesture.ts";

/** The sheet is at rest; the opening animation no longer owns its transform. */
const spring = "cubic-bezier(.2, .8, .2, 1)";

/**
 * Swipe-down dismissal for a mobile bottom sheet. The gesture starts only when the sheet is at
 * the top: otherwise a downward finger scrolls its content as usual. While dragging, the sheet
 * follows the finger with the scrim fading out; a short or slow release springs back.
 */
export function useSheetDismiss(options: {
  element: Ref<HTMLElement | undefined>;
  enabled: Ref<boolean>;
  close: () => void;
}) {
  const dragging = ref(false);
  let unbind: (() => void) | undefined;
  let animation: Animation | undefined;
  let drag = 0;

  function reset(element: HTMLElement) {
    animation?.cancel();
    animation = undefined;
    element.style.transform = "";
    element.style.removeProperty("--sheet-scrim");
    element.style.transition = "";
    element.style.willChange = "";
    dragging.value = false;
    drag = 0;
  }
  function animate(element: HTMLElement, to: string, done: () => void) {
    if (prefersReducedMotion() || typeof element.animate !== "function") return done();
    animation?.cancel();
    const running = element.animate(
      [{ transform: `translate3d(0, ${drag}px, 0)` }, { transform: to }],
      { duration: 180, easing: spring },
    );
    animation = running;
    running.onfinish = () => {
      if (animation !== running) return;
      animation = undefined;
      done();
    };
  }
  function settle(element: HTMLElement) {
    animate(element, "translate3d(0, 0, 0)", () => reset(element));
  }
  function dismiss(element: HTMLElement) {
    animate(element, "translate3d(0, 100%, 0)", () => {
      options.close();
      reset(element);
    });
  }

  function start(element: HTMLElement) {
    animation?.cancel();
    animation = undefined;
    // The open animation uses a transform too; the finger takes it over from now on.
    element.style.animation = "none";
    element.style.transition = "none";
    element.style.willChange = "transform";
    dragging.value = true;
  }
  function move(element: HTMLElement, progress: SwipeProgress) {
    drag = Math.max(0, progress.delta);
    element.style.transform = `translate3d(0, ${drag}px, 0)`;
    // The sheet paints its own scrim as a huge box-shadow, so one variable fades it.
    const alpha = 0.6 * (1 - Math.min(drag / 320, 1));
    element.style.setProperty("--sheet-scrim", `rgb(0 0 0 / ${alpha.toFixed(3)})`);
  }
  function end(element: HTMLElement) {
    dragging.value = false;
    const height = element.getBoundingClientRect().height || 0;
    const threshold = Math.max(56, Math.min(height * 0.28, 120));
    if (drag >= threshold) dismiss(element);
    else settle(element);
  }

  function sync() {
    unbind?.();
    unbind = undefined;
    const element = options.element.value;
    if (!element || !options.enabled.value) {
      if (element) reset(element);
      return;
    }
    unbind = bindSwipeGesture(element, {
      axis: "y",
      enabled: () => options.enabled.value,
      ignoreTarget: swipeTargetIgnored,
      canStart: (event, moveGesture) =>
        moveGesture.delta > 0 && !scrollsInDirection(event.target, "y", 1, element),
      onStart: () => start(element),
      onMove: (progress) => move(element, progress),
      onEnd: () => end(element),
      onCancel: () => settle(element),
    });
  }

  watch([options.element, options.enabled], sync, { flush: "post" });
  onBeforeUnmount(() => {
    unbind?.();
    unbind = undefined;
    if (options.element.value) reset(options.element.value);
  });

  return { dragging };
}
