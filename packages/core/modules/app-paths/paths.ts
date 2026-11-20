import { os } from "../os/index.ts";
import { join } from "node:path";

export const APP_PORT = 4177;
export const APP_HOST = "localhost";
export const APP_CLASS = "Projector";
export const APP_NAME = "projector";

// Shared across Vite runtime generations. Only the HTTP listener sets it.
const runtime = globalThis as typeof globalThis & { projectorAppPort?: number };

export function setAppPort(port: number): void {
  runtime.projectorAppPort = port;
}

export function appPort(): number {
  return runtime.projectorAppPort ?? APP_PORT;
}

export function configuredAppPort(): number {
  const port = Number(process.env.PROJECTOR_PORT);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : APP_PORT;
}

export function appUrl(port = appPort()): string {
  return `http://${APP_HOST}:${port}`;
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
