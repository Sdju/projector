import { os } from "../os/index.ts";
import { join } from "node:path";

export const APP_PORT = 4177;
export const APP_HOST = "localhost";
export const APP_CLASS = "Projector";
export const APP_NAME = "projector";

export function appUrl(): string {
  return `http://${APP_HOST}:${APP_PORT}`;
}

export function projectAppUrl(id: string): string {
  return `${appUrl()}/api/projects/${encodeURIComponent(id)}/app`;
}

export function dataDir(): string {
  const root = os.dataHome();
  return join(root, APP_NAME);
}

export function instancePath(): string {
  return join(dataDir(), "instance.json");
}

export function chromeProfileDir(): string {
  return join(dataDir(), "chrome-profile");
}

export function launchLockPath(): string {
  return join(dataDir(), "launch.lock");
}

export function providersPath(): string {
  return join(dataDir(), "providers.json");
}

/** Режим следующего запуска сервера: `dev` или `prod`. */
export function serverModePath(): string {
  return join(dataDir(), "server-mode");
}

/** Режим доступа к серверу: `local` или `lan`. */
export function networkModePath(): string {
  return join(dataDir(), "network-mode");
}

/** Хеш пароля доступа по локальной сети (scrypt `salt:hash`). */
export function lanPasswordPath(): string {
  return join(dataDir(), "lan-password");
}
