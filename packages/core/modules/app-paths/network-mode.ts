import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isNetworkMode, type NetworkMode } from "../network-mode/index.ts";
import { networkModePath } from "./paths.ts";

/**
 * Режим доступа к серверу; по умолчанию local. `PROJECTOR_NETWORK` задаёт
 * одноразовый запуск (флаг `--lan`/`--local`) и имеет приоритет над файлом.
 */
export function readNetworkMode(): NetworkMode {
  const env = process.env.PROJECTOR_NETWORK;
  if (env === "local" || env === "lan") return env;
  try {
    const value = readFileSync(networkModePath(), "utf8").trim();
    return isNetworkMode(value) ? value : "local";
  } catch {
    return "local";
  }
}

export function writeNetworkMode(mode: NetworkMode): void {
  mkdirSync(dirname(networkModePath()), { recursive: true });
  writeFileSync(networkModePath(), `${mode}\n`, "utf8");
}
