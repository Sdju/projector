import type { MediaCapability } from "@ai-projector/core/modules/media/index.ts";
import type { MediaAdapter } from "./types.ts";

const adapters = new Map<string, MediaAdapter>();

/** Регистрирует адаптер вида провайдера; возвращает функцию снятия. */
export function registerMediaAdapter(adapter: MediaAdapter): () => void {
  if (adapters.has(adapter.kind)) throw new Error(`Медиа-адаптер уже занят: ${adapter.kind}`);
  adapters.set(adapter.kind, adapter);
  return () => {
    if (adapters.get(adapter.kind) === adapter) adapters.delete(adapter.kind);
  };
}

export function mediaAdapter(kind: string): MediaAdapter | undefined {
  return adapters.get(kind);
}

export function mediaAdapters(): MediaAdapter[] {
  return [...adapters.values()];
}

export function mediaAdapterCapabilities(kind: string): MediaCapability[] {
  return [...(adapters.get(kind)?.capabilities ?? [])];
}
