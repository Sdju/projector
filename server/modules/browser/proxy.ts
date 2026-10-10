import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  fromProxyUrl,
  parseProxyHost,
  proxyUrl,
  type ProxyHost,
} from "../../../core/modules/browser/index.ts";
import { isLocalRequest } from "../access/index.ts";
import { INTERNAL_MESSAGE, guardedLookup, isInternalLiteral } from "./guard.ts";
import { cookieHeader, siteOf, storeCookie } from "./cookies.ts";
import { proxyKey } from "./key.ts";
import { rewriteCss, rewriteHtml, type RewriteContext } from "./rewrite.ts";

const MAX_REWRITE = 20 * 1024 * 1024;
const REQUEST_TIMEOUT = 30_000;
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

/** Заголовки запроса, которые переходят к сайту как есть. Cookie, Origin и Referer собираются отдельно. */
const FORWARDED = [
  "accept",
  "accept-language",
  "user-agent",
  "range",
  "if-range",
  "if-none-match",
  "if-modified-since",
  "content-type",
  "content-length",
  "authorization",
  "cache-control",
  "pragma",
  "x-requested-with",
  "access-control-request-method",
  "access-control-request-headers",
];
/** Заголовки ответа, которые запрещали бы встраивание, привязывали к настоящему origin или ломают переписанное тело. */
const DROPPED = new Set([
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "set-cookie",
  "set-cookie2",
  "strict-transport-security",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "location",
  "content-location",
  "link",
  "report-to",
  "nel",
  "alt-svc",
  "public-key-pins",
  "clear-site-data",
  "origin-agent-cluster",
  "permissions-policy",
]);

class ProxyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function fail(res: ServerResponse, status: number, message: string) {
  if (res.headersSent) return res.destroy();
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

/** Настоящий origin, который сайт должен увидеть вместо origin прокси; `undefined`, если это не страница прокси. */
function realOrigin(value: string | undefined): string | undefined {
  if (!value) return;
  try {
    const host = parseProxyHost(new URL(value).host);
    return host?.origin;
  } catch {
    return;
  }
}

function charsetOf(type: string, head: Buffer): string {
  const label =
    type.match(/charset\s*=\s*["']?([\w:.-]+)/i)?.[1] ??
    (type.startsWith("text/html")
      ? head
          .subarray(0, 2048)
          .toString("latin1")
          .match(/<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i)?.[1]
      : undefined);
  try {
    return new TextDecoder(label ?? "utf-8").encoding;
  } catch {
    return "utf-8";
  }
}

function readLimited(response: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REWRITE) {
        response.destroy();
        reject(new ProxyError(413, "Страница слишком большая для просмотра"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => resolve(Buffer.concat(chunks)));
    response.on("error", reject);
  });
}

/** Заголовки запроса к сайту: Origin и Referer возвращаются к настоящим адресам, cookies берутся из jar. */
function upstreamHeaders(req: IncomingMessage, target: URL): Record<string, string> {
  const headers: Record<string, string> = { "accept-encoding": "identity" };
  for (const name of FORWARDED) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const origin = realOrigin(req.headers.origin);
  if (origin) headers.origin = origin;
  const referer =
    typeof req.headers.referer === "string" ? fromProxyUrl(req.headers.referer) : undefined;
  if (referer) headers.referer = referer;
  const initiator = origin ?? (referer ? new URL(referer).origin : undefined);
  const sameSite = !initiator || siteOf(new URL(initiator).hostname) === siteOf(target.hostname);
  const navigation = req.headers["sec-fetch-mode"] === "navigate" && req.method === "GET";
  const cookie = cookieHeader(target, { navigation, sameSite });
  if (cookie) headers.cookie = cookie;
  return headers;
}

function responseHeaders(
  upstream: IncomingMessage,
  target: URL,
  host: ProxyHost,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(upstream.headers)) {
    if (DROPPED.has(name) || value === undefined) continue;
    if (name === "access-control-allow-origin") {
      let mapped = value as string;
      if (mapped !== "*" && mapped !== "null")
        mapped = (proxyUrl(mapped, host.suffix) ?? mapped).replace(/\/$/, "");
      out[name] = mapped;
      continue;
    }
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  const location = upstream.headers.location;
  if (location) {
    try {
      const next = new URL(location, target);
      out.location = proxyUrl(next, host.suffix) ?? location;
    } catch {
      out.location = location;
    }
  }
  for (const header of upstream.headers["set-cookie"] ?? []) storeCookie(header, target);
  return out;
}

async function serve(req: IncomingMessage, res: ServerResponse, host: ProxyHost): Promise<void> {
  if (!isLocalRequest(req)) throw new ProxyError(403, "Прокси доступен только на этом компьютере");
  if (host.nonce !== proxyKey()) throw new ProxyError(404, "Не найдено");
  const method = req.method ?? "GET";
  if (!METHODS.has(method)) throw new ProxyError(405, "Метод не поддерживается");
  if (!req.url?.startsWith("/") || req.url.startsWith("//"))
    throw new ProxyError(400, "Некорректный адрес");
  const target = new URL(req.url, host.origin);
  if (target.origin !== host.origin) throw new ProxyError(400, "Некорректный адрес");
  if (isInternalLiteral(target.hostname)) throw new ProxyError(403, INTERNAL_MESSAGE);

  const context: RewriteContext = { page: target, suffix: host.suffix };
  const send = target.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
    const outgoing = send(
      target,
      {
        method,
        headers: upstreamHeaders(req, target),
        lookup: guardedLookup,
        timeout: REQUEST_TIMEOUT,
      },
      resolve,
    );
    outgoing.on("timeout", () => outgoing.destroy(new ProxyError(504, "Сайт не отвечает")));
    outgoing.on("error", (error) =>
      reject(
        error instanceof ProxyError
          ? error
          : new ProxyError(
              error.message === INTERNAL_MESSAGE ? 403 : 502,
              error.message === INTERNAL_MESSAGE
                ? INTERNAL_MESSAGE
                : `Не удалось открыть сайт: ${error.message}`,
            ),
      ),
    );
    res.on("close", () => outgoing.destroy());
    if (method === "GET" || method === "HEAD") outgoing.end();
    else req.pipe(outgoing);
  });

  const status = upstream.statusCode ?? 502;
  const headers = responseHeaders(upstream, target, host);
  const type = (upstream.headers["content-type"] ?? "").toLowerCase();
  const rewrite =
    method !== "HEAD" &&
    status !== 204 &&
    status !== 304 &&
    (type.startsWith("text/html") || type.startsWith("text/css"));
  if (!rewrite) {
    if (upstream.headers["content-length"])
      headers["content-length"] = upstream.headers["content-length"];
    res.writeHead(status, headers);
    if (method === "HEAD") {
      upstream.resume();
      res.end();
      return;
    }
    upstream.pipe(res);
    upstream.on("error", () => res.destroy());
    return;
  }
  const raw = await readLimited(upstream);
  const text = new TextDecoder(charsetOf(type, raw)).decode(raw);
  const html = type.startsWith("text/html");
  const body = Buffer.from(html ? rewriteHtml(text, context) : rewriteCss(text, context), "utf8");
  delete headers.etag;
  delete headers["last-modified"];
  headers["content-type"] = `${type.split(";")[0]}; charset=utf-8`;
  headers["content-length"] = String(body.length);
  headers["cache-control"] = "no-store";
  res.writeHead(status, headers);
  res.end(body);
}

/**
 * Запрос к origin прокси (`<хост>.<тег>.<nonce>.proxy.localhost`). Выполняется до общей проверки
 * доступа: Host такого запроса не доверенный, поэтому обработчик сам требует loopback-клиента и nonce.
 * Возвращает `false`, если запрос не к прокси.
 */
export async function handleProxyHost(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const host = parseProxyHost(req.headers.host ?? "");
  if (!host) return false;
  try {
    await serve(req, res, host);
  } catch (error) {
    if (error instanceof ProxyError) fail(res, error.status, error.message);
    else fail(res, 500, "Ошибка прокси");
  }
  return true;
}

/** Запрос адресован origin прокси (по заголовку Host). */
export const isProxyHost = (req: IncomingMessage) => !!parseProxyHost(req.headers.host ?? "");
