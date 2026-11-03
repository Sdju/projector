export interface ImageTransform {
  zoom: number;
  x: number;
  y: number;
}
export function zoomImageAt(
  view: ImageTransform,
  requested: number,
  x: number,
  y: number,
): ImageTransform {
  const bounded = Math.max(1 / 64, Math.min(32, requested));
  // An incremental zoom must land on the natural size before crossing it.
  const zoom = (view.zoom < 1 && bounded > 1) || (view.zoom > 1 && bounded < 1) ? 1 : bounded;
  const ratio = zoom / view.zoom;
  return { zoom, x: x - (x - view.x) * ratio, y: y - (y - view.y) * ratio };
}
/** Breathing room around a fitted image; a small viewport (phone in landscape) must not lose it all. */
const margin = (size: number) => Math.min(48, size * 0.1);
export function fitImage(
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) {
  return Math.max(
    1 / 64,
    Math.min(
      32,
      Math.max(1, viewportWidth - margin(viewportWidth)) / width,
      Math.max(1, viewportHeight - margin(viewportHeight)) / height,
    ),
  );
}
