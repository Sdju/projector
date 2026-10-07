import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configHome } from "./directories.ts";

/** Use Cursor Agent CLI credentials; never write or publish the auth file. */
export async function readCursorAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    const content =
      process.env.CURSOR_AUTH_CONTENT ??
      (await readFile(join(configHome(), "cursor", "auth.json"), "utf8"));
    auth = JSON.parse(content);
  } catch {
    throw new Error("Авторизация Cursor недоступна; выполните agent login");
  }
  const token =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).accessToken : null;
  if (typeof token !== "string" || !token.trim())
    throw new Error("Авторизация Cursor недоступна; выполните agent login");
  return token;
}
