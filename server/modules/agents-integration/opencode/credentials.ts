import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { os } from "../../../../core/modules/os/index.ts";

const UNAVAILABLE = "Авторизация OpenCode недоступна; выполните opencode auth login";
const NOT_CONNECTED = "OpenCode Go не подключён; выполните opencode auth login";

const candidates = () => [
  join(os.dataHome(), "opencode", "auth.json"),
  join(os.homeDirectory(), ".local", "share", "opencode", "auth.json"),
];

/** The data directory and the legacy home path are both checked; the first readable one wins. */
async function readFirstReadable(): Promise<string> {
  for (const path of candidates()) {
    try {
      return await readFile(path, "utf8");
    } catch {
      /* Try the next location. */
    }
  }
  throw new Error(UNAVAILABLE);
}

/** Use OpenCode's existing Go credentials; never write or publish the auth file. */
export async function readOpenCodeGoKey(): Promise<string> {
  let auth: unknown;
  try {
    auth = JSON.parse(process.env.OPENCODE_AUTH_CONTENT ?? (await readFirstReadable()));
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const entry =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>)["opencode-go"] : null;
  const key = entry && typeof entry === "object" ? (entry as Record<string, unknown>).key : null;
  if (typeof key !== "string" || !key.trim()) throw new Error(NOT_CONNECTED);
  return key;
}
