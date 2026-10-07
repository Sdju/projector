import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { configHome } from "./directories.ts";

const candidates = () => [
  join(configHome(), "cursor", "auth.json"),
  join(configHome(), "Cursor", "auth.json"),
];

/** Use Cursor Agent CLI credentials; never write or publish the auth file. */
export async function readCursorAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    const content =
      process.env.CURSOR_AUTH_CONTENT ??
      (await Promise.any(candidates().map((path) => readFile(path, "utf8"))));
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
