import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const AUTH_UNAVAILABLE = "Авторизация Cursor недоступна; выполните agent login";

export function cursorConfigHome(): string {
  if (process.env.XDG_CONFIG_HOME) return process.env.XDG_CONFIG_HOME;
  if (process.platform === "win32")
    return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return join(homedir(), ".config");
}

export function cursorCacheHome(): string {
  if (process.env.XDG_CACHE_HOME) return process.env.XDG_CACHE_HOME;
  if (process.platform === "win32")
    return process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  return join(homedir(), ".cache");
}

export function cursorHome(): string {
  return join(homedir(), ".cursor");
}

const authCandidates = () => [
  join(cursorConfigHome(), "cursor", "auth.json"),
  join(cursorConfigHome(), "Cursor", "auth.json"),
];

/** The auth file lives under either spelling of the directory; the first readable one wins. */
async function readFirstReadable(): Promise<string> {
  for (const path of authCandidates()) {
    try {
      return await readFile(path, "utf8");
    } catch {
      /* Try the next location. */
    }
  }
  throw new Error(AUTH_UNAVAILABLE);
}

/** Use Cursor Agent CLI credentials; never write or publish the auth file. */
export async function readCursorAccessToken(): Promise<string> {
  let auth: unknown;
  try {
    auth = JSON.parse(process.env.CURSOR_AUTH_CONTENT ?? (await readFirstReadable()));
  } catch {
    throw new Error(AUTH_UNAVAILABLE);
  }
  const token =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).accessToken : null;
  if (typeof token !== "string" || !token.trim()) throw new Error(AUTH_UNAVAILABLE);
  return token;
}

function jwtClaim(token: string, name: string): string {
  const parts = token.split(".");
  if (parts.length < 2) return "";
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
    const value = (payload as Record<string, unknown>)[name];
    return typeof value === "string" && value.trim() ? value : "";
  } catch {
    return "";
  }
}

/** Dashboard POSTs want the WorkOS session cookie, not a Bearer header. */
export function cursorSessionCookie(token: string): string {
  const sub = jwtClaim(token, "sub");
  return `WorkosCursorSessionToken=${sub ? `${sub}::${token}` : token}`;
}

/**
 * Bounded POST to a fixed Cursor URL. Failures never include the upstream body or the token.
 */
export async function cursorPostJson(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fail: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new Error(fail);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 401)
      throw new Error("Авторизация Cursor истекла; выполните agent login");
    if (response.status === 403) throw new Error("Подписка Cursor недоступна");
    throw new Error(`Cursor: ошибка HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Некорректный ответ Cursor");
  }
}
