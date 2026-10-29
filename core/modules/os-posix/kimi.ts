import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Seconds before the stated expiry at which a token counts as expired. */
const EXPIRY_BUFFER = 300;

/** A token from one credential file, or null when that file has no usable token. */
function tokenOf(content: string): string | null {
  let auth: unknown;
  try {
    auth = JSON.parse(content);
  } catch {
    return null;
  }
  const token =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).access_token : null;
  if (typeof token !== "string" || !token.trim()) return null;
  const expiresAt =
    auth && typeof auth === "object" ? (auth as Record<string, unknown>).expires_at : null;
  if (typeof expiresAt === "number" && expiresAt - EXPIRY_BUFFER <= Date.now() / 1000) return null;
  return token;
}

/**
 * Use the Kimi Code CLI OAuth credentials; never write or publish the credential files.
 * The CLI names them `kimi-code-env-<id>.json`, so every file of the directory is tried.
 */
export async function readKimiAccessToken(): Promise<string> {
  const override = process.env.KIMI_AUTH_CONTENT;
  if (override !== undefined) {
    const token = tokenOf(override);
    if (token) return token;
    throw new Error("Авторизация Kimi Code недоступна; выполните kimi login");
  }
  let files: string[];
  try {
    files = (await readdir(join(homedir(), ".kimi-code", "credentials"))).filter((name) =>
      name.endsWith(".json"),
    );
  } catch {
    throw new Error("Авторизация Kimi Code недоступна; выполните kimi login");
  }
  for (const name of files) {
    const token = await readFile(join(homedir(), ".kimi-code", "credentials", name), "utf8")
      .then(tokenOf)
      .catch(() => null);
    if (token) return token;
  }
  throw new Error("Авторизация Kimi Code недоступна или истекла; выполните kimi login");
}
