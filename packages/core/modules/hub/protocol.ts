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
