import { fileUrlPath, isLocalPath } from "../../../common/utilities/file-path.ts";

/** A link in an agent answer: a web address opens in a browser tab, a file opens in the editor. */
export interface ChatPlainLink {
  href: string;
  kind: "web" | "anchor" | "other";
}
export interface ChatFileLink {
  href: string;
  kind: "file";
  /** The file path without the query, fragment and line range. */
  path: string;
  /** The path is outside the project: an absolute path or a `file:` URL. */
  external: boolean;
  line?: number;
  endLine?: number;
  column?: number;
}
export type ChatLink = ChatPlainLink | ChatFileLink;

const WEB_PROTOCOL = /^(?:https?:|mailto:|tel:)/i;
const OTHER_PROTOCOL = /^[a-z][a-z\d+.-]*:/i;
const HASH_RANGE = /#L(\d+)(?:-L?(\d+))?(?:C(\d+))?$/i;
const COLON_RANGE = /:(\d+)(?:-(\d+))?(?::(\d+))?$/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function splitRange(href: string): {
  path: string;
  line?: number;
  endLine?: number;
  column?: number;
} {
  const hash = HASH_RANGE.exec(href);
  if (hash)
    return {
      path: href.slice(0, hash.index),
      line: Number(hash[1]),
      ...(hash[2] ? { endLine: Number(hash[2]) } : {}),
      ...(hash[3] ? { column: Number(hash[3]) } : {}),
    };
  const colon = COLON_RANGE.exec(href);
  if (colon)
    return {
      path: href.slice(0, colon.index),
      line: Number(colon[1]),
      ...(colon[2] ? { endLine: Number(colon[2]) } : {}),
      ...(colon[3] ? { column: Number(colon[3]) } : {}),
    };
  return { path: href };
}

/**
 * What a markdown link in an agent answer means. A web address keeps its own protocol; a path is
 * a project file unless it is absolute or a `file:` URL. Line ranges survive in `path/to/file:12`
 * and `path/to/file#L12-L34`, so a link to code opens the same lines the agent meant.
 */
export function parseChatLink(href: string): ChatLink {
  const value = href.trim();
  if (!value) return { href, kind: "other" };
  if (value.startsWith("#")) return { href, kind: "anchor" };
  if (WEB_PROTOCOL.test(value) || value.startsWith("//")) return { href, kind: "web" };
  if (/^file:\/\//i.test(value)) {
    const { path: source, ...range } = splitRange(value);
    const path = fileUrlPath(source);
    return path ? { href, kind: "file", path, external: true, ...range } : { href, kind: "other" };
  }
  if (OTHER_PROTOCOL.test(value) && !isLocalPath(value)) return { href, kind: "other" };
  const { path: source, ...range } = splitRange(value);
  const raw = (source.split(/[?#]/)[0] ?? "").replace(/^\.\//, "");
  if (!raw) return { href, kind: "anchor" };
  const path = decode(raw);
  return { href, kind: "file", path, external: isLocalPath(path), ...range };
}
