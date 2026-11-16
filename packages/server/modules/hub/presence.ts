import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";

interface PresenceState {
  devices: HubDevice[];
  activity: Record<string, number>;
}

const MAX_ACTIVITY = 128;

// The connector outlives a Vite module reload, exactly like the Hub publisher below.
const root = globalThis as typeof globalThis & { projectorHubPresence?: PresenceState };
const state = (root.projectorHubPresence ??= { devices: [], activity: {} });

const copy = (device: HubDevice): HubDevice => ({
  id: device.id,
  name: device.name,
  protocol: device.protocol,
  online: device.online,
});

/** The Hub snapshot is the only source for devices this machine has not opened itself. */
export function setHubDevices(devices: readonly HubDevice[]): void {
  state.devices = devices.map(copy);
}

/** A remote device changed its jobs or runs; pages show it without reading the device. */
export function noteHubActivity(deviceId: string, at: number): void {
  if (!Number.isFinite(at)) return;
  const entries = Object.entries(state.activity).filter(([id]) => id !== deviceId);
  if (entries.length >= MAX_ACTIVITY) entries.splice(0, entries.length - MAX_ACTIVITY + 1);
  state.activity = Object.fromEntries([...entries, [deviceId, at]]);
}

/** A dropped tunnel makes every other device unreachable for this machine. */
export function markHubDevicesOffline(): void {
  state.devices = state.devices.map((device) => ({ ...device, online: false }));
}

export function resetHubPresence(): void {
  state.devices = [];
  state.activity = {};
}

/** Devices and last activity known by this connector for local pages. */
export function hubPresence(): { devices: HubDevice[]; activity: Record<string, number> } {
  return {
    devices: state.devices.map(copy),
    activity: { ...state.activity },
  };
}
