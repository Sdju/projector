// Render as an image, never insert file markup into the application's DOM.
export function svgPreview(content: string, color: string) {
  const parser = new DOMParser();
  let document = parser.parseFromString(content, "image/svg+xml");
  let svg = document.documentElement;
  if (
    document.querySelector("parsererror") ||
    svg.localName !== "svg" ||
    (svg.namespaceURI && svg.namespaceURI !== "http://www.w3.org/2000/svg")
  ) {
    throw new Error("Не удалось отобразить SVG: проверьте разметку исходника.");
  }
  if (!svg.namespaceURI) {
    svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    document = parser.parseFromString(new XMLSerializer().serializeToString(svg), "image/svg+xml");
    svg = document.documentElement;
  }
  const viewBox = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const dimension = (name: string) => {
    const value = svg.getAttribute(name)?.trim() ?? "";
    return /^\d+(?:\.\d+)?(?:px)?$/.test(value) ? parseFloat(value) : NaN;
  };
  let width = dimension("width"),
    height = dimension("height");
  const validViewBox =
    viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0;
  if (!(width > 0 && height > 0)) {
    const ratio = validViewBox ? viewBox[2]! / viewBox[3]! : 2;
    if (width > 0) height = width / ratio;
    else if (height > 0) width = height * ratio;
    else {
      width = validViewBox ? viewBox[2]! : 300;
      height = validViewBox ? viewBox[3]! : 150;
    }
  }
  // Keep paths, fixed fills, internal styles and aspect ratio intact.
  const style = (svg as unknown as SVGSVGElement).style;
  style.setProperty("color", color, "important");
  style.setProperty("width", "100%", "important");
  style.setProperty("height", "100%", "important");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  if (!validViewBox && !svg.hasAttribute("viewBox"))
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return {
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`,
    width,
    height,
  };
}
