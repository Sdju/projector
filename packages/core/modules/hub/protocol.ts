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

/** Hub tells a device which devices are online; the device passes it to its pages. */
export interface HubDevicesEvent {
  type: "hub-event";
  event: "devices";
  devices: HubDevice[];
}

/**
 * Another device changed its jobs or runs. It carries no job data: the page reads that device
 * again. `at` is the time of the change on the sending device.
 */
export interface HubActivityEvent {
  type: "hub-event";
  event: "activity";
  deviceId: string;
  at: number;
}

/** Device to Hub: its own jobs or runs changed. */
export interface HubActivity {
  type: "activity";
  at: number;
}

export type HubToDevice = HubDevicesEvent | HubActivityEvent;

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
