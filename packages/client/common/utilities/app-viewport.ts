/**
 * Visible height of the phone screen above the soft keyboard.
 *
 * The keyboard shrinks only the visual viewport: `100dvh`, `window.innerHeight` and
 * `position: fixed` keep the layout viewport, so a composer pinned to the bottom stays under
 * the keyboard. Safari also pans the visual viewport down to reveal the focused field, so the
 * visible bottom edge is `height + offsetTop`. The Fullscreen API and an installed PWA hide
 * browser chrome but not the keyboard: the same measurement covers them.
 */
export interface VisualViewportBox {
  height: number;
  offsetTop?: number;
}

/** Browser chrome moves the viewport by tens of pixels; a soft keyboard is much taller. */
export const keyboardMinHeight = 120;

/** CSS pixels of the layout viewport hidden below the visible bottom edge. */
export function viewportInset(viewport: VisualViewportBox, layoutHeight: number): number {
  const bottom = viewport.height + Math.max(0, viewport.offsetTop ?? 0);
  return Math.max(0, Math.round(layoutHeight - bottom));
}

/** CSS pixels from the top of the layout viewport to the bottom edge the user can see. */
export function visibleAppHeight(viewport: VisualViewportBox, layoutHeight: number): number {
  const bottom = viewport.height + Math.max(0, viewport.offsetTop ?? 0);
  return Math.round(Math.max(0, Math.min(bottom, layoutHeight)));
}

/**
 * Publishes the visible height as `--app-viewport-height` while the keyboard is open and
 * removes it otherwise, so `100dvh` keeps driving the layout without a keyboard.
 */
export function syncAppViewport(
  root: HTMLElement,
  viewport: VisualViewportBox,
  layoutHeight: number,
): number | undefined {
  if (viewportInset(viewport, layoutHeight) < keyboardMinHeight) {
    root.style.removeProperty("--app-viewport-height");
    return undefined;
  }
  const height = visibleAppHeight(viewport, layoutHeight);
  const value = `${height}px`;
  if (root.style.getPropertyValue("--app-viewport-height") !== value)
    root.style.setProperty("--app-viewport-height", value);
  return height;
}

let dispose: (() => void) | undefined;

/** Tracks the area above the soft keyboard for phone layouts that fill the screen. */
export function initAppViewport(): () => void {
  if (dispose) return dispose;
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  const root = document.documentElement;
  const sync = () => syncAppViewport(root, viewport, window.innerHeight);
  sync();
  viewport.addEventListener("resize", sync);
  viewport.addEventListener("scroll", sync);
  dispose = () => {
    viewport.removeEventListener("resize", sync);
    viewport.removeEventListener("scroll", sync);
    root.style.removeProperty("--app-viewport-height");
    dispose = undefined;
  };
  return dispose;
}
