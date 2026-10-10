/**
 * Cookie-jar прокси. Cookies сайтов хранятся на сервере, а не в браузере: страница
 * не может подбросить их чужим сайтам через `Domain=proxy.localhost`, а HttpOnly остаётся
 * недоступным скриптам. Правила RFC 6265 упрощены: списка публичных суффиксов нет.
 */
interface Cookie {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  sameSite: "none" | "lax" | "strict";
  expires?: number;
}

const MAX_COOKIES = 3000;
const MAX_SIZE = 4096;

const store = globalThis as typeof globalThis & { projectorBrowserJar?: Cookie[] };
const jar = (store.projectorBrowserJar ??= []);

const domainMatches = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);
const defaultPath = (path: string) => {
  const end = path.lastIndexOf("/");
  return end > 0 ? path.slice(0, end) : "/";
};
const pathMatches = (path: string, cookie: string) =>
  path === cookie ||
  (path.startsWith(cookie) && (cookie.endsWith("/") || path[cookie.length] === "/"));

/** Принимает заголовок Set-Cookie ответа на запрос `url`. */
export function storeCookie(header: string, url: URL, now = Date.now()): void {
  if (header.length > MAX_SIZE) return;
  const [pair, ...attributes] = header.split(";");
  const separator = pair!.indexOf("=");
  if (separator < 1) return;
  const cookie: Cookie = {
    name: pair!.slice(0, separator).trim(),
    value: pair!.slice(separator + 1).trim(),
    domain: url.hostname,
    hostOnly: true,
    path: defaultPath(url.pathname),
    secure: false,
    sameSite: "lax",
  };
  let maxAge: number | undefined;
  for (const attribute of attributes) {
    const [rawName = "", ...rest] = attribute.split("=");
    const name = rawName.trim().toLowerCase();
    const value = rest.join("=").trim();
    if (name === "domain" && value) {
      const domain = value.replace(/^\./, "").toLowerCase();
      if (!domain.includes(".") || !domainMatches(url.hostname, domain)) return;
      cookie.domain = domain;
      cookie.hostOnly = false;
    } else if (name === "path" && value.startsWith("/")) cookie.path = value;
    else if (name === "secure") cookie.secure = true;
    else if (name === "samesite") {
      const mode = value.toLowerCase();
      if (mode === "none" || mode === "strict" || mode === "lax") cookie.sameSite = mode;
    } else if (name === "max-age" && /^-?\d+$/.test(value)) maxAge = Number(value);
    else if (name === "expires") {
      const time = Date.parse(value);
      if (Number.isFinite(time)) cookie.expires = time;
    }
  }
  if (maxAge !== undefined) cookie.expires = now + maxAge * 1000;
  if (cookie.secure && url.protocol !== "https:") return;
  const index = jar.findIndex(
    (item) =>
      item.name === cookie.name && item.domain === cookie.domain && item.path === cookie.path,
  );
  if (index !== -1) jar.splice(index, 1);
  if (cookie.expires !== undefined && cookie.expires <= now) return;
  jar.push(cookie);
  if (jar.length > MAX_COOKIES) jar.shift();
}

export interface CookieRequest {
  /** Переход документа (`Sec-Fetch-Mode: navigate`) методом GET: так отправляются и Lax-cookies. */
  navigation: boolean;
  /** Запрос начат страницей того же сайта или пользователем (нет Origin и Referer). */
  sameSite: boolean;
}

/** Заголовок Cookie для запроса `url`; просроченные cookies удаляются. */
export function cookieHeader(url: URL, request: CookieRequest, now = Date.now()): string {
  for (let index = jar.length - 1; index >= 0; index--) {
    const expires = jar[index]!.expires;
    if (expires !== undefined && expires <= now) jar.splice(index, 1);
  }
  return jar
    .filter((cookie) => {
      if (cookie.secure && url.protocol !== "https:") return false;
      if (
        cookie.hostOnly
          ? url.hostname !== cookie.domain
          : !domainMatches(url.hostname, cookie.domain)
      )
        return false;
      if (!pathMatches(url.pathname, cookie.path)) return false;
      if (cookie.sameSite === "none" || request.sameSite) return true;
      return cookie.sameSite === "lax" && request.navigation;
    })
    .sort((a, b) => b.path.length - a.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
}

/** Грубая граница «сайта»: последние две метки имени (три для `co.uk`-подобных). */
export function siteOf(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  const wide = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
  return labels.slice(wide ? -3 : -2).join(".");
}

export function clearCookies(): void {
  jar.length = 0;
}
