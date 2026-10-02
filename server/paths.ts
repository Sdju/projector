import { homedir } from "node:os";
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
  const root = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
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
