/**
 * The project-relative path `href` points to, resolved against the document `path`. Foreign
 * schemes, anchors, parent segments, NUL and backslashes are not project paths.
 */
export function markdownPath(href: string, path: string): string | undefined {
  if (!href || href.startsWith("#") || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return;
  try {
    const url = new URL(href, `https://projector.invalid/${path}`);
    const result = decodeURIComponent(url.pathname.slice(1));
    if (result.split("/").includes("..") || result.includes("\0") || result.includes("\\")) return;
    return result;
  } catch {
    return;
  }
}
