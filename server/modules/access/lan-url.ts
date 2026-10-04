import { networkInterfaces } from "node:os";
import { APP_PORT } from "../../../core/modules/app-paths/index.ts";

function privateAddresses(): string[] {
  const result: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      result.push(entry.address);
    }
  }
  return result;
}

/** Все адреса Projector в локальной сети для открытия с других устройств. */
export function lanUrls(): string[] {
  return privateAddresses().map((address) => `http://${address}:${APP_PORT}`);
}

/** Первый адрес Projector в локальной сети. */
export function lanUrl(): string | null {
  return lanUrls()[0] ?? null;
}
