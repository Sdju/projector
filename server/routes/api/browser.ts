import { pipeline } from "node:stream/promises";
import { HttpError } from "../../modules/http/index.ts";
import { fetchThroughProxy } from "../../modules/browser/index.ts";
import { BROWSER_PROXY_PREFIX, fromProxyPath } from "../../../core/modules/browser/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

/**
 * Страницы интернета для псевдобраузера. Ответ отдаётся с `Content-Security-Policy: sandbox`
 * без `allow-same-origin`: документ получает пустой origin и не дотягивается до API Projector.
 */
export async function handleBrowser({ req, res, url, method }: RouteContext): Promise<boolean> {
  if (!url.pathname.startsWith(BROWSER_PROXY_PREFIX)) return false;
  if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Допустим только GET");
  const target = fromProxyPath(`${url.pathname}${url.search}`);
  if (!target) throw new HttpError(400, "Некорректный адрес страницы");
  const result = await fetchThroughProxy(new URL(target), req.headers, method);
  for (const [name, value] of Object.entries(result.headers)) res.setHeader(name, value);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Content-Security-Policy",
    "sandbox allow-scripts allow-forms allow-popups allow-modals",
  );
  res.statusCode = result.status;
  if (Buffer.isBuffer(result.body)) {
    res.end(result.body);
    return true;
  }
  await pipeline(result.body, res).catch(() => res.destroy());
  return true;
}
