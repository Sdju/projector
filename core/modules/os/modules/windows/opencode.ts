import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataHome } from "./directories.ts";

const candidates = () => [
  join(dataHome(), "opencode", "auth.json"),
  join(homedir(), ".local", "share", "opencode", "auth.json"),
];

/** Use OpenCode's existing Go credentials; never write or publish the auth file. */
export async function readOpenCodeGoKey(): Promise<string> {
  let auth: unknown;
  try {
    const content =
      process.env.OPENCODE_AUTH_CONTENT ??
      (await Promise.any(candidates().map((path) => readFile(path, "utf8"))));
    auth = JSON.parse(content);
  } catch {
    throw new Error("Авторизация OpenCode недоступна; выполните opencode auth login");
  }
  const entry =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>)["opencode-go"] : null;
  const key = entry && typeof entry === "object" ? (entry as Record<string, unknown>).key : null;
  if (typeof key !== "string" || !key.trim())
    throw new Error("OpenCode Go не подключён; выполните opencode auth login");
  return key;
}
