/** A page stays attached to one device for its entire lifetime, including its caches/workers. */
export function deviceBase(path = globalThis.location?.pathname ?? ""): string {
  return /^\/devices\/[a-z0-9][a-z0-9-]{0,62}(?:\/|$)/.exec(path)?.[0].replace(/\/$/, "") ?? "";
}
export function deviceApiPrefix(): string {
  const base = deviceBase();
  return base ? `/api${base}` : "";
}
export function deviceUrl(value: string | URL): string {
  const raw = String(value);
  const prefix = deviceApiPrefix();
  if (!prefix) return raw;
  if (raw.startsWith("/api/") && !raw.startsWith("/api/devices/") && !raw.startsWith("/api/hub/"))
    return prefix + raw.slice(4);
  try {
    const url = new URL(raw);
    if (url.host === location.host && ["http:", "https:", "ws:", "wss:"].includes(url.protocol)) {
      url.pathname = deviceUrl(url.pathname);
      return url.href;
    }
  } catch {
    /* Relative resource paths remain relative. */
  }
  return raw;
}
