export const HUB_PROTOCOL = 1;

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(value);
}

export interface HubConnection {
  url: string;
  deviceId: string;
  token: string;
}

export interface HubDevice {
  id: string;
  name: string;
  protocol: number;
  online: boolean;
}

export interface HubOpen {
  type: "open";
  id: string;
}

/** Only a same-origin device page can be resumed after signing in. */
export function hubReturnPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/devices/") || value.includes("\\"))
    return "/";
  try {
    const url = new URL(value, "https://hub.invalid");
    if (
      url.origin !== "https://hub.invalid" ||
      !/^\/devices\/[a-z0-9][a-z0-9-]{0,62}(?:\/|$)/.test(url.pathname)
    )
      return "/";
    return url.pathname + url.search + url.hash;
  } catch {
    return "/";
  }
}
