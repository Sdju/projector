/**
 * Адреса псевдобраузера. Страница из интернета открывается с собственного origin
 * `<хост>.<тег>.<nonce>.proxy.localhost:<порт>`: у неё настоящие относительные ссылки,
 * fetch и хранилище, а API Projector остаётся на другом origin.
 */
export const PROXY_DOMAIN = "proxy.localhost";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
const PRIVATE_HOST =
  /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.)|\.(?:localhost|local)$/;
const PROXY_HOST = /^(.+)\.([sh])(\d{0,5})\.([0-9a-f]{16})\.proxy\.localhost(?::(\d{1,5}))?$/i;

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

/** Прокси доступен, когда Projector открыт на этом компьютере: `*.localhost` указывает на него. */
export function proxyAvailableFor(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/** Окончание хоста прокси: `<nonce>.proxy.localhost[:порт]`. */
export function proxySuffix(nonce: string, port: string | number = ""): string {
  return `${nonce}.${PROXY_DOMAIN}${port ? `:${port}` : ""}`;
}

/** Адрес на origin прокси; `undefined` для не-http(s), IPv6 и слишком длинных имён. */
export function proxyUrl(url: string | URL, suffix: string): string | undefined {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return;
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return;
  if (target.hostname.includes(":")) return;
  const tag = (target.protocol === "https:" ? "s" : "h") + target.port;
  const host = `${target.hostname}.${tag}.${suffix}`;
  if (host.length > 253) return;
  return `http://${host}${target.pathname}${target.search}${target.hash}`;
}

export interface ProxyHost {
  /** Origin настоящего сайта: `https://example.com`. */
  origin: string;
  nonce: string;
  /** Окончание хоста прокси с портом: им же собираются адреса других сайтов. */
  suffix: string;
}

/** Разбирает заголовок Host запроса к прокси; `undefined`, если это не хост прокси. */
export function parseProxyHost(host: string): ProxyHost | undefined {
  const match = host.toLowerCase().match(PROXY_HOST);
  if (!match) return;
  const [, hostname, scheme, targetPort, nonce, port] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
    string | undefined,
  ];
  return {
    origin: `${scheme === "s" ? "https" : "http"}://${hostname}${targetPort ? `:${targetPort}` : ""}`,
    nonce,
    suffix: proxySuffix(nonce, port),
  };
}

/** Адрес настоящего сайта по адресу на origin прокси. */
export function fromProxyUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const host = parseProxyHost(parsed.host);
    if (!host) return;
    return `${host.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return;
  }
}
