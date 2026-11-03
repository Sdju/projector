import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;
export const PAGE_CHARS = 20_000;

/** Addresses of this machine or its network: a page the agent reads must not be a way in. */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/i.exec(address);
  if (mapped) {
    if (mapped[1]) return isPrivateAddress(mapped[1]);
    const high = parseInt(mapped[2]!, 16);
    const low = parseInt(mapped[3]!, 16);
    return isPrivateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  if (isIP(address) === 4) {
    const [a, b = 0] = address.split(".").map(Number) as [number, number?];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && address.startsWith("192.0.0.")))) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  const text = address.toLowerCase();
  return (
    text === "::" ||
    text === "::1" ||
    /^f[cd]/.test(text) ||
    /^fe[89ab]/.test(text) ||
    text.startsWith("ff")
  );
}

/** Connects only to public addresses, checked at the moment of connecting (no DNS rebinding). */
const publicLookup: typeof lookup = ((host: string, options: object, done: Function) => {
  lookup(host, { ...options, all: true }, (error, addresses) => {
    if (error) return done(error);
    const list = addresses as unknown as { address: string; family: number }[];
    if (!list.length || list.some((item) => isPrivateAddress(item.address)))
      return done(new Error("Адрес из локальной сети недоступен агенту"));
    if ((options as { all?: boolean }).all) return done(null, list);
    done(null, list[0]!.address, list[0]!.family);
  });
}) as never;

interface Fetched {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  truncated: boolean;
}

function once(url: URL, signal?: AbortSignal): Promise<Fetched> {
  return new Promise((resolve, reject) => {
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return reject(new Error("Только адреса http и https"));
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && isPrivateAddress(host))
      return reject(new Error("Адрес из локальной сети недоступен агенту"));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        lookup: publicLookup,
        timeout: TIMEOUT_MS,
        signal,
        headers: {
          "user-agent": "Projector-Agent/1",
          accept: "text/html,text/plain,application/json,application/xml;q=0.9,*/*;q=0.1",
          "accept-encoding": "identity",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            truncated = true;
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
            truncated,
          });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error("Сайт не ответил за 20 с")));
    req.on("error", reject);
    req.end();
  });
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
};

function decode(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1]?.toLowerCase() === "x" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

/** Readable text of an HTML page: no scripts, styles or markup, blocks on their own lines. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(
      /<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote|table|ul|ol|header|footer)>/gi,
      "\n",
    )
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) =>
      decode(line)
        .replace(/[ \t\f\v]+/g, " ")
        .trim(),
    )
    .filter(Boolean)
    .join("\n");
  return { title, text };
}

export interface WebPage {
  url: string;
  status: number;
  title: string;
  text: string;
  truncated: boolean;
}

/** Reads a public page as text, following redirects only to public addresses. */
export async function fetchPage(
  address: string,
  options: { maxChars?: number; signal?: AbortSignal } = {},
): Promise<WebPage> {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new Error("Некорректный адрес");
  }
  for (let hop = 0; ; hop++) {
    const page = await once(url, options.signal);
    const location = page.headers.location;
    if (page.status >= 300 && page.status < 400 && typeof location === "string") {
      if (hop >= MAX_REDIRECTS) throw new Error("Слишком много перенаправлений");
      url = new URL(location, url);
      continue;
    }
    const type = String(page.headers["content-type"] ?? "").toLowerCase();
    if (
      type &&
      !/^(text\/|application\/(json|xml|xhtml|ld\+json|rss|atom))|\+(json|xml)\b/.test(type)
    )
      throw new Error(`Не текстовое содержимое: ${type.split(";")[0]}`);
    const raw = page.body.toString("utf8");
    const parsed =
      /html/.test(type) || /^\s*<(!doctype|html)/i.test(raw)
        ? htmlToText(raw)
        : { title: "", text: raw.trim() };
    const limit = options.maxChars ?? PAGE_CHARS;
    return {
      url: url.href,
      status: page.status,
      title: parsed.title,
      text: parsed.text.slice(0, limit),
      truncated: page.truncated || parsed.text.length > limit,
    };
  }
}
