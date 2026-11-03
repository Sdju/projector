/**
 * `local` — сервер слушает только loopback; `lan` — все сетевые интерфейсы,
 * чтобы управлять Projector с телефона или другой машины в локальной сети.
 */
export type NetworkMode = "local" | "lan";

export const NETWORK_MODES: readonly NetworkMode[] = ["local", "lan"];

export function isNetworkMode(value: unknown): value is NetworkMode {
  return value === "local" || value === "lan";
}

/** Хост Vite-сервера для режима доступа. */
export function networkHost(mode: NetworkMode): string {
  return mode === "lan" ? "0.0.0.0" : "localhost";
}
