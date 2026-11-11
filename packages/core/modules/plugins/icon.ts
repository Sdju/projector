const maxIconBytes = 32_000;
const iconFilePattern = /^[a-zA-Z0-9._/-]+\.svg$/;
const forbidden =
  /<script|<\/script|<!--|on[a-z]+\s*=|javascript:|data:|foreignObject|<iframe|<object|<embed|<link|<meta|<style|<use\b|<image\b|<svg\b/i;
const svgRoot = /^<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i;
const viewBoxAttr = /\bviewBox\s*=\s*["']([^"']+)["']/i;
const viewBoxValue = /^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?){3}$/;

/** A package-relative SVG path the plugin may use instead of a Lucide name. */
export function isPluginIconFile(value: string): boolean {
  return (
    value.length <= 300 &&
    iconFilePattern.test(value) &&
    !value.startsWith("/") &&
    !/(^|\/)\.\.(\/|$)/.test(value)
  );
}

/**
 * Turns a plugin SVG into a single `<svg>` the client can render as the agent button.
 * Scripts, event handlers, nested documents and external references are rejected.
 */
export function sanitizePluginIconSvg(svg: string): string {
  const trimmed = svg.trim();
  if (!trimmed || trimmed.length > maxIconBytes) throw new Error("Некорректная SVG-иконка агента");
  const match = svgRoot.exec(trimmed);
  if (!match) throw new Error("Некорректная SVG-иконка агента");
  const opening = match[1] ?? "";
  const viewBox = viewBoxAttr.exec(opening)?.[1] ?? "0 0 24 24";
  if (!viewBoxValue.test(viewBox)) throw new Error("Некорректная SVG-иконка агента");
  const inner = (match[2] ?? "").trim();
  if (!inner || forbidden.test(opening) || forbidden.test(inner))
    throw new Error("Некорректная SVG-иконка агента");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="currentColor">${inner}</svg>`;
}
