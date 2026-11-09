import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@projector/core/modules/app-paths/index.ts";
import { isDeviceId, type HubConnection } from "@projector/core/modules/hub/index.ts";
import { connectHub, type HubHandlers } from "./connector.ts";

const path = () => join(dataDir(), "hub.json");
interface State {
  config?: HubConnection;
  online: boolean;
  apply?: (config?: HubConnection) => void;
}
const root = globalThis as typeof globalThis & { projectorHub?: State };
const state = (root.projectorHub ??= { online: false });

export function hubStatus() {
  return {
    enabled: !!state.config,
    online: state.online,
    url: state.config?.url,
    deviceId: state.config?.deviceId,
  };
}
function connectionConfig(value: unknown): HubConnection | undefined {
  let config: HubConnection | undefined;
  if (value !== null) {
    const input = value as Partial<HubConnection>;
    if (
      !input ||
      typeof input.url !== "string" ||
      !isDeviceId(input.deviceId) ||
      typeof input.token !== "string" ||
      !input.token ||
      input.token.length > 4096
    )
      throw new Error("Нужны url, deviceId и token");
    const url = new URL(input.url);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("Укажите origin Hub без пути и credentials");
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
      throw new Error("Для удалённого Hub требуется HTTPS");
    config = { url: url.origin, deviceId: input.deviceId, token: input.token };
  }
  return config;
}
export function configureHub(value: unknown): void {
  const config = connectionConfig(value);
  mkdirSync(dataDir(), { recursive: true });
  const temporary = path() + ".tmp";
  writeFileSync(temporary, JSON.stringify(config ?? null), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path());
  state.config = config;
  state.apply?.(config);
}
export function bindHub(handlers: HubHandlers): () => void {
  let stop: (() => void) | undefined;
  let epoch = 0;
  const apply = (config?: HubConnection) => {
    const current = ++epoch;
    stop?.();
    stop = undefined;
    state.online = false;
    if (config)
      stop = connectHub(config, handlers, (online) => {
        if (epoch === current) state.online = online;
      });
  };
  // Runtime rebind must dispose the previous connector before installing a replacement.
  state.apply?.(undefined);
  state.apply = apply;
  try {
    state.config = connectionConfig(JSON.parse(readFileSync(path(), "utf8")));
  } catch {
    state.config = undefined;
  }
  apply(state.config);
  return () => {
    stop?.();
    if (state.apply === apply) state.apply = undefined;
  };
}
