import hljs from "highlight.js/lib/common";

/** Names without a useful extension, and extensions highlight.js calls differently. */
const ALIASES: Record<string, string> = {
  vue: "xml",
  svelte: "xml",
  astro: "xml",
  mdx: "markdown",
};

/** The highlight.js language of a file, from its name; empty when the name says nothing. */
export function codeLanguage(path: string | undefined): string {
  if (!path) return "";
  const name = (path.split(/[\\/]/).at(-1) ?? path).toLowerCase();
  const extension = name.includes(".") ? name.split(".").at(-1)! : name;
  const language = ALIASES[extension] ?? extension;
  return hljs.getLanguage(language) ? language : "";
}
