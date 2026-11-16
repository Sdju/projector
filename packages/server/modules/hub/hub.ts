import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { isDeviceId, type HubConnection } from "@ai-projector/core/modules/hub/index.ts";
import { HttpError } from "../http/index.ts";
import { connectHub, type HubHandlers } from "./connector.ts";

const path = () => join(dataDir(), "hub.json");
interface State {
  config?: HubConnection;
  connections?: HubConnection[];
  online: boolean;
  error?: string;
  apply?: (config?: HubConnection) => void;
}
const root = globalThis as typeof globalThis & { projectorHub?: State };
const state = (root.projectorHub ??= { online: false });

state.connections ??= state.config ? [state.config] : [];

export function hubStatus() {
  return {
    enabled: !!state.config,
    online: state.online,
    url: state.config?.url,
    deviceId: state.config?.deviceId,
    error: state.error,
    connections: state.connections!.map(({ url, deviceId }) => ({ url, deviceId })),
  };
}

const LOGIN_CODE = /^[a-f0-9]{64}$/;

/** Asks the saved Hub for a one-time browser login URL using the device token. */
export async function requestHubLoginLink(): Promise<{ url: string; ttl: number }> {
  const config = state.config;
  if (!config) throw new HttpError(409, "Сначала подключите Hub");
  let response: Response;
  try {
    response = await fetch(new URL("/api/hub/login-link", config.url), {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new HttpError(502, "Не удалось запросить ссылку входа у Hub");
  }
  const data: unknown = await response.json().catch(() => ({}));
  const error =
    data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error
      : undefined;
  if (!response.ok)
    throw new HttpError(
      response.status === 401 || response.status === 403 ? response.status : 502,
      error ?? "Hub отклонил ссылку входа",
    );
  if (!data || typeof data !== "object")
    throw new HttpError(502, "Hub вернул некорректную ссылку входа");
  const { url, ttl } = data as { url?: unknown; ttl?: unknown };
  if (
    typeof url !== "string" ||
    typeof ttl !== "number" ||
    !Number.isInteger(ttl) ||
    ttl < 1 ||
    ttl > 300
  )
    throw new HttpError(502, "Hub вернул некорректную ссылку входа");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(502, "Hub вернул некорректную ссылку входа");
  }
  if (
    parsed.origin !== config.url ||
    parsed.pathname !== "/login" ||
    parsed.hash ||
    [...parsed.searchParams.keys()].join() !== "code" ||
    !LOGIN_CODE.test(parsed.searchParams.get("code") ?? "")
  )
    throw new HttpError(502, "Hub вернул некорректную ссылку входа");
  return { url, ttl };
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
/** An origin identifies one saved Hub. Only config owns a running connector. */
export function configureHub(value: unknown): void {
  let connections = [...state.connections!];
  let config = state.config;
  if (value === null) {
    connections = [];
    config = undefined;
  } else {
    const input = value as Partial<HubConnection> & { action?: string; enabled?: boolean };
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("Нужны параметры подключения Hub");
    if (input.enabled === false) config = undefined;
    else if (input.action === "activate" || input.action === "delete") {
      const saved = connections.find((item) => item.url === input.url);
      if (!saved) throw new Error("Hub не найден");
      if (input.action === "activate") config = saved;
      else {
        connections = connections.filter((item) => item !== saved);
        if (config?.url === saved.url) config = undefined;
      }
    } else {
      if (input.action && input.action !== "save") throw new Error("Неизвестное действие Hub");
      const saved =
        typeof input.url === "string"
          ? connections.find((item) => item.url === new URL(input.url!).origin)
          : undefined;
      const next = connectionConfig({
        ...input,
        token: input.token === "" || input.token === undefined ? saved?.token : input.token,
      })!;
      connections = connections.filter((item) => item.url !== next.url);
      connections.push(next);
      // Legacy PUT connects immediately; saving a profile only updates an active match.
      if (input.action !== "save" || config?.url === next.url) config = next;
    }
  }
  mkdirSync(dataDir(), { recursive: true });
  const temporary = path() + ".tmp";
  writeFileSync(temporary, JSON.stringify({ connections, activeUrl: config?.url ?? null }), {
    mode: 0o600,
  });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path());
  const changed = JSON.stringify(state.config) !== JSON.stringify(config);
  state.connections = connections;
  state.config = config;
  if (changed) state.apply?.(config);
}
export function bindHub(handlers: HubHandlers): () => void {
  let stop: (() => void) | undefined;
  let epoch = 0;
  const apply = (config?: HubConnection) => {
    const current = ++epoch;
    stop?.();
    stop = undefined;
    state.online = false;
    state.error = undefined;
    if (config)
      stop = connectHub(config, handlers, (online, error) => {
        if (epoch === current) {
          state.online = online;
          state.error = error;
        }
      });
  };
  // Runtime rebind must dispose the previous connector before installing a replacement.
  state.apply?.(undefined);
  state.apply = apply;
  try {
    const stored = JSON.parse(readFileSync(path(), "utf8"));
    if (stored && Array.isArray(stored.connections)) {
      const connections = stored.connections.map((item: unknown) => connectionConfig(item)!);
      if (
        connections.some((item: HubConnection) => !item) ||
        new Set(connections.map((item: HubConnection) => item.url)).size !== connections.length
      )
        throw new Error("Некорректный список Hub");
      state.connections = connections;
      state.config = connections.find((item: HubConnection) => item.url === stored.activeUrl);
    } else {
      state.config = connectionConfig(stored);
      state.connections = state.config ? [state.config] : [];
    }
  } catch {
    state.connections = [];
    state.config = undefined;
  }
  apply(state.config);
  return () => {
    stop?.();
    if (state.apply === apply) state.apply = undefined;
  };
}
