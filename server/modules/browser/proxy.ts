import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup } from "node:dns";
import { BlockList, isIP } from "node:net";
import { HttpError } from "../http/index.ts";
import { toProxyPath } from "../../../core/modules/browser/index.ts";

const MAX_REWRITE = 20 * 1024 * 1024;
const REQUEST_TIMEOUT = 30_000;

/** Адреса машины и локальной сети: прокси их не открывает, чтобы страница из интернета не ходила во внутренние сервисы. */
const internal = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  internal.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  internal.addSubnet(net, prefix, "ipv6");

function isInternalAddress(address: string): boolean {
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const value = mapped?.[1] ?? address;
  const family = isIP(value);
  return !family || internal.check(value, family === 6 ? "ipv6" : "ipv4");
}

/** DNS-разрешение с проверкой: тот же адрес, к которому подключается сокет, а значит DNS rebinding не обойдёт запрет. */
const guardedLookup: typeof lookup = ((hostname: string, options: unknown, callback: unknown) => {
  const done = (typeof options === "function" ? options : callback) as (
    error: Error | null,
    address?: string | { address: string; family: number }[],
    family?: number,
  ) => void;
  const all = typeof options === "object" && !!options && (options as { all?: boolean }).all;
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) return done(error);
    const allowed = addresses.filter((item) => !isInternalAddress(item.address));
    if (!allowed.length)
      return done(new HttpError(403, "Прокси не открывает адреса локальной сети") as Error);
    if (all) return done(null, allowed);
    done(null, allowed[0]!.address, allowed[0]!.family);
  });
}) as typeof lookup;

const REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "user-agent",
  "range",
  "if-none-match",
  "if-modified-since",
];
const DROPPED_RESPONSE = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "set-cookie",
  "set-cookie2",
  "strict-transport-security",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "location",
  "content-location",
  "link",
  "refresh",
  "report-to",
  "nel",
  "alt-svc",
  "public-key-pins",
]);

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  /** Тело целиком, если его переписали; иначе поток от сервера. */
  body: Buffer | IncomingMessage;
}

function resolveTarget(value: string, base: string): string | undefined {
  const text = value.trim();
  if (!text || text.startsWith("#") || /^(?:javascript|data|mailto|tel|blob|about):/i.test(text))
    return;
  try {
    const url = new URL(text, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    url.hash = "";
    return toProxyPath(url.href) + (new URL(text, base).hash || "");
  } catch {
    return;
  }
}

export function rewriteCss(css: string, base: string): string {
  return css
    .replace(/url\(\s*(["']?)([^"')]*?)\1\s*\)/gi, (whole, quote: string, value: string) => {
      const target = resolveTarget(value, base);
      return target ? `url(${quote}${target}${quote})` : whole;
    })
    .replace(/@import\s+(["'])([^"']+)\1/gi, (whole, quote: string, value: string) => {
      const target = resolveTarget(value, base);
      return target ? `@import ${quote}${target}${quote}` : whole;
    });
}

const URL_ATTRIBUTES =
  /(\s(?:src|href|action|formaction|poster|data|background)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const SRCSET = /(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const STRIPPED_ATTRIBUTES =
  /\s(?:integrity|nonce|crossorigin)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s>/])/gi;
const STYLE_ATTRIBUTE = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi;
const STYLE_BLOCK = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
const META_BLOCKED =
  /<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh|set-cookie)[^>]*>/gi;
const BASE_TAG = /<base\b[^>]*>/i;

/** Переписывает ссылки HTML на прокси и добавляет скрипт, сообщающий родителю адрес и заголовок. */
export function rewriteHtml(html: string, pageUrl: string): string {
  let base = pageUrl;
  const baseTag = html.match(BASE_TAG)?.[0];
  const baseHref = baseTag?.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
  if (baseHref)
    try {
      base = new URL(baseHref[1] ?? baseHref[2] ?? "", pageUrl).href;
    } catch {
      // A broken <base> is ignored by browsers too.
    }
  const quoted = (
    prefix: string,
    double: string | undefined,
    single: string | undefined,
    map: (value: string) => string,
  ) => {
    const quote = double !== undefined ? '"' : "'";
    return `${prefix}${quote}${map(double ?? single ?? "")}${quote}`;
  };
  const rewritten = html
    .replace(BASE_TAG, "")
    .replace(META_BLOCKED, "")
    .replace(STRIPPED_ATTRIBUTES, "")
    .replace(
      STYLE_BLOCK,
      (_, open: string, css: string, close: string) => open + rewriteCss(css, base) + close,
    )
    .replace(STYLE_ATTRIBUTE, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) => rewriteCss(value, base)),
    )
    .replace(SRCSET, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) =>
        value
          .split(",")
          .map((part) => {
            const [link, ...rest] = part.trim().split(/\s+/);
            return [(link && resolveTarget(link, base)) || link, ...rest].join(" ");
          })
          .join(", "),
      ),
    )
    .replace(URL_ATTRIBUTES, (_whole, prefix, d, s) =>
      quoted(prefix, d, s, (value) => resolveTarget(value, base) ?? value),
    );
  return injectShim(rewritten, pageUrl);
}

function injectShim(html: string, pageUrl: string): string {
  const data = JSON.stringify(pageUrl).replace(/</g, "\\u003c");
  const script = `<script>(function(){var u=${data};function s(){try{parent.postMessage({projectorBrowser:true,url:u,title:document.title},"*")}catch(e){}}addEventListener("DOMContentLoaded",s);addEventListener("load",s);new MutationObserver(s).observe(document.documentElement,{childList:true,subtree:true,characterData:true});})()</script>`;
  const head = html.match(/<head\b[^>]*>/i);
  if (head) return html.replace(head[0], head[0] + script);
  const root = html.match(/<html\b[^>]*>/i);
  return root ? html.replace(root[0], root[0] + script) : script + html;
}

function readLimited(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REWRITE) {
        response.destroy();
        reject(new HttpError(413, "Страница слишком большая для просмотра"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

function charsetOf(contentType: string): BufferEncoding {
  const label = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase();
  return label === "latin1" || label === "iso-8859-1" || label === "windows-1252"
    ? "latin1"
    : "utf8";
}

/** Загружает страницу как её увидел бы браузер, снимает запреты встраивания и переписывает ссылки. */
export function fetchThroughProxy(
  target: URL,
  incoming: IncomingHttpHeaders,
  method: string,
): Promise<ProxyResponse> {
  if (target.protocol !== "http:" && target.protocol !== "https:")
    throw new HttpError(400, "Допустимы только http и https");
  if (target.username || target.password)
    throw new HttpError(400, "Адрес не должен содержать пароль");
  // Для адреса-литерала Node не вызывает lookup, поэтому проверяем его здесь.
  const literal = target.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isInternalAddress(literal))
    throw new HttpError(403, "Прокси не открывает адреса локальной сети");
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  for (const name of REQUEST_HEADERS) {
    const value = incoming[name];
    if (typeof value === "string") headers[name] = value;
  }
  return new Promise((resolve, reject) => {
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send(
      target,
      { method, headers, lookup: guardedLookup, timeout: REQUEST_TIMEOUT },
      (response) => {
        void answer(response).then(resolve, reject);
      },
    );
    upstream.on("timeout", () => upstream.destroy(new HttpError(504, "Сайт не отвечает")));
    upstream.on("error", (error) =>
      reject(
        error instanceof HttpError
          ? error
          : new HttpError(502, `Не удалось открыть сайт: ${error.message}`),
      ),
    );
    upstream.end();

    async function answer(response: IncomingMessage): Promise<ProxyResponse> {
      const status = response.statusCode ?? 502;
      const out: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (DROPPED_RESPONSE.has(name) || value === undefined) continue;
        out[name] = Array.isArray(value) ? value.join(", ") : value;
      }
      const location = response.headers.location;
      if (location && status >= 300 && status < 400) {
        const next = resolveTarget(location, target.href);
        if (next) out.location = next;
        response.resume();
        return { status, headers: out, body: Buffer.alloc(0) };
      }
      const type = (response.headers["content-type"] ?? "").toLowerCase();
      const rewrite = type.startsWith("text/html") || type.startsWith("text/css");
      if (!rewrite || method === "HEAD" || status === 204 || status === 304) {
        if (method === "HEAD") response.resume();
        return { status, headers: out, body: method === "HEAD" ? Buffer.alloc(0) : response };
      }
      const source = (await readLimited(response)).toString(charsetOf(type));
      const text = type.startsWith("text/html")
        ? rewriteHtml(source, target.href)
        : rewriteCss(source, target.href);
      const body = Buffer.from(text, "utf8");
      out["content-type"] = `${type.split(";")[0]}; charset=utf-8`;
      out["content-length"] = String(body.length);
      return { status, headers: out, body };
    }
  });
}
