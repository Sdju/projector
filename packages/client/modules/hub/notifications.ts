import { ref } from "vue";

/**
 * Browser notification choices for other Hub devices. They belong to this browser origin, like
 * the read marks of the work centre: a phone may want every device, a desktop only its own.
 */
const storageKey = () => `projector:hub-notify:${globalThis.location?.origin ?? "local"}`;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // A blocked storage must not break the work centre.
    return undefined;
  }
}

function load(): string[] {
  try {
    const value: unknown = JSON.parse(storage()?.getItem(storageKey()) ?? "[]");
    return Array.isArray(value)
      ? value.filter(
          (item): item is string =>
            typeof item === "string" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(item),
        )
      : [];
  } catch {
    return [];
  }
}

const muted = ref<string[]>(load());

function persist(): void {
  try {
    storage()?.setItem(storageKey(), JSON.stringify(muted.value));
  } catch {
    // The current page still honours the choice until it closes.
  }
}

export const hubMutedDevices = (): readonly string[] => muted.value;

export const hubNotifyEnabled = (deviceId: string): boolean => !muted.value.includes(deviceId);

export function setHubNotifyEnabled(deviceId: string, enabled: boolean): void {
  const next = new Set(muted.value);
  if (enabled) next.delete(deviceId);
  else next.add(deviceId);
  muted.value = [...next].sort();
  persist();
}

/** The work centre decides whether a notice belongs to a muted remote device. */
export function hubNoticeAllowed(deviceId: string | undefined | null): boolean {
  return !deviceId || hubNotifyEnabled(deviceId);
}
