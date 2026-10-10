/** Адреса псевдобраузера: страница из интернета открывается через прокси Projector. */
export const BROWSER_PROXY_PREFIX = "/api/browser/";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const PRIVATE_HOST =
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)|\.(?:localhost|local)$/;

/** Доводит ввод адресной строки до URL: без схемы это localhost-порт, домен или поисковый запрос. */
export function normalizeBrowserInput(input: string): string {
  const text = input.trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return new URL(text).href;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(text))
    return new URL(`http://${text}`).href;
  if (/^:\d{2,5}(?:[/?#]|$)/.test(text)) return new URL(`http://localhost${text}`).href;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text))
    return new URL(`https://${text}`).href;
  return `https://duckduckgo.com/?q=${encodeURIComponent(text)}`;
}

/** Страницы машины и локальной сети (dev-серверы) открываются напрямую, без прокси. */
export function isLocalBrowserTarget(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return LOCAL_HOSTS.has(host) || PRIVATE_HOST.test(host);
  } catch {
    return false;
  }
}

/** Путь прокси для http(s)-адреса: `/api/browser/<схема>/<хост>/<путь>?<запрос>`. */
export function toProxyPath(url: string): string {
  const target = new URL(url);
  return `${BROWSER_PROXY_PREFIX}${target.protocol.slice(0, -1)}/${target.host}${target.pathname}${target.search}`;
}

/** Исходный адрес по пути прокси; `undefined`, если путь не похож на него. */
export function fromProxyPath(path: string): string | undefined {
  if (!path.startsWith(BROWSER_PROXY_PREFIX)) return;
  const match = path.slice(BROWSER_PROXY_PREFIX.length).match(/^(https?)\/([^/?#]+)(\/[^#]*)?$/);
  if (!match) return;
  try {
    return new URL(`${match[1]}://${match[2]}${match[3] ?? "/"}`).href;
  } catch {
    return;
  }
}

/** Адрес для `iframe`: локальные страницы напрямую, остальные через прокси. */
export function browserFrameSrc(url: string, proxy: boolean | "auto" = "auto"): string {
  if (!url) return "about:blank";
  const viaProxy = proxy === "auto" ? !isLocalBrowserTarget(url) : proxy;
  return viaProxy ? toProxyPath(url) : url;
}
