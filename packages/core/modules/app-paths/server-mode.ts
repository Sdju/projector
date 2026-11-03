import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { isServerMode, type ServerMode } from "../server-mode/index.ts";
import { serverModePath } from "./paths.ts";

/** Режим следующего запуска сервера; по умолчанию dev. */
export function readServerMode(): ServerMode {
  try {
    const value = readFileSync(serverModePath(), "utf8").trim();
    return isServerMode(value) ? value : "dev";
  } catch {
    return "dev";
  }
}

export function writeServerMode(mode: ServerMode): void {
  mkdirSync(dirname(serverModePath()), { recursive: true });
  writeFileSync(serverModePath(), `${mode}\n`, "utf8");
}
