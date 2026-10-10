import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../../core/modules/app-paths/index.ts";

const store = globalThis as typeof globalThis & { projectorBrowserKey?: string };

/**
 * Секрет в имени хоста прокси. Его знает только интерфейс Projector (он получает ключ через
 * проверенный API), поэтому чужая страница не может обратиться к `*.proxy.localhost` и
 * воспользоваться cookies прокси. Хранится на диске, чтобы localStorage сайтов переживал restart.
 */
export function proxyKey(): string {
  if (store.projectorBrowserKey) return store.projectorBrowserKey;
  const path = join(dataDir(), "browser-proxy-key");
  let key = "";
  try {
    key = readFileSync(path, "utf8").trim();
  } catch {
    // The key is created below on first use.
  }
  if (!/^[0-9a-f]{16}$/.test(key)) {
    key = randomBytes(8).toString("hex");
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(path, key, { mode: 0o600 });
    try {
      chmodSync(path, 0o600);
    } catch {
      // Best effort on platforms without POSIX modes.
    }
  }
  return (store.projectorBrowserKey = key);
}
