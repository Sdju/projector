import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataHome } from "./directories.ts";

/** Use OpenCode's existing Go credentials; never write or publish the auth file. */
export async function readOpenCodeGoKey(): Promise<string> {
  let auth: unknown;
  try {
    const content =
      process.env.OPENCODE_AUTH_CONTENT ??
      (await readFile(join(dataHome(), "opencode", "auth.json"), "utf8"));
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
