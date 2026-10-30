import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { os } from "../../../../core/modules/os/index.ts";

const UNAVAILABLE = "Авторизация Cursor недоступна; выполните agent login";

const candidates = () => [
  join(os.configHome(), "cursor", "auth.json"),
  join(os.configHome(), "Cursor", "auth.json"),
];

/** The auth file lives under either spelling of the directory; the first readable one wins. */
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

/** Use Cursor Agent CLI credentials; never write or publish the auth file. */
export async function readCursorAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    auth = JSON.parse(process.env.CURSOR_AUTH_CONTENT ?? (await readFirstReadable()));
  } catch {
    throw new Error(UNAVAILABLE);
  }
  const token =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).accessToken : null;
  if (typeof token !== "string" || !token.trim()) throw new Error(UNAVAILABLE);
  return token;
}
