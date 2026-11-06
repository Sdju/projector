import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  credentialPaths,
  kimiHome,
  positiveNumber,
  readKimiConfig,
  record,
  resolveOAuthHost,
  stringField,
  type KimiConfig,
} from "./credential-config.ts";

/** Kimi Code's public device-flow client; the refresh grant is authorised by the user's token. */
const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
/** The CLI refreshes at max(300 s, expires_in / 2); a 15-minute token lasts 7.5 minutes here. */
const MIN_REFRESH_THRESHOLD = 300;
const DEFAULT_EXPIRES_IN = 900;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;
const REQUEST_TIMEOUT_MS = 10000;

const UNAVAILABLE = "Авторизация Kimi Code недоступна; выполните kimi login";
const EXPIRED = "Авторизация Kimi Code недоступна или истекла; выполните kimi login";
const UNSUPPORTED_STORAGE = "Kimi Code хранит токен вне файла; Projector не может его обновить";
const LOCKED = "Не удалось обновить токен Kimi Code: обновление уже выполняется";
const REFRESH_FAILED = "Не удалось обновить токен Kimi Code";

interface KimiCredential {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  expiresIn: number | null;
  /** Null for `KIMI_AUTH_CONTENT`: there is no file to write a rotated pair back to. */
  path: string | null;
  raw: Record<string, unknown>;
  oauthHost: string;
}

interface RefreshedToken {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  expiresIn: number;
  scope: string | null;
  tokenType: string | null;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function parseCredential(
  raw: string,
  path: string | null,
  config: KimiConfig,
): KimiCredential | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const data = record(parsed);
  if (!data) return null;
  const accessToken = stringField(data.access_token) ?? "";
  const refreshToken = stringField(data.refresh_token);
  if (!accessToken && !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    expiresAt: positiveNumber(data.expires_at, true),
    expiresIn: positiveNumber(data.expires_in),
    path,
    raw: data,
    oauthHost: resolveOAuthHost(config, accessToken),
  };
}

function refreshThreshold(credential: KimiCredential): number {
  return Math.max(MIN_REFRESH_THRESHOLD, (credential.expiresIn ?? DEFAULT_EXPIRES_IN) / 2);
}

function needsRefresh(credential: KimiCredential, now = Date.now() / 1000): boolean {
  if (!credential.accessToken) return true;
  if (credential.expiresAt === null) return false;
  return credential.expiresAt - now <= refreshThreshold(credential);
}

async function readCredentialFile(path: string, config: KimiConfig): Promise<KimiCredential> {
  const raw = await readFile(path, "utf8");
  const credential = parseCredential(raw, path, config);
  if (!credential) throw new Error(UNAVAILABLE);
  return credential;
}

async function requestRefresh(credential: KimiCredential): Promise<RefreshedToken> {
  if (!credential.refreshToken) throw new Error(EXPIRED);
  let response: Response;
  try {
    response = await fetch(`${trimSlash(credential.oauthHost)}/api/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "KimiCLI/1.6",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: CLIENT_ID,
        refresh_token: credential.refreshToken,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    throw new Error(REFRESH_FAILED);
  }
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 400 || response.status === 401 || response.status === 403)
      throw new Error(EXPIRED);
    throw new Error(`Kimi Code: не удалось обновить токен (HTTP ${response.status})`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Некорректный ответ Kimi Code");
  }
  const data = record(payload);
  const accessToken = stringField(data?.access_token);
  if (!accessToken) throw new Error("Некорректный ответ Kimi Code");
  const expiresIn = positiveNumber(data?.expires_in) ?? DEFAULT_EXPIRES_IN;
  return {
    accessToken,
    refreshToken: stringField(data?.refresh_token) ?? credential.refreshToken,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    expiresIn,
    scope: stringField(data?.scope),
    tokenType: stringField(data?.token_type),
  };
}

async function writeCredential(path: string, value: Record<string, unknown>): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600).catch(() => undefined);
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/**
 * Serialise refreshes with the official CLI: its `proper-lockfile` lock is a directory next to
 * the `oauth/<slot>` sentinel, and the refresh token rotates on every grant.
 */
async function withRefreshLock<T>(slot: string, run: () => Promise<T>): Promise<T> {
  const target = join(kimiHome(), "oauth", slot);
  const lockPath = `${target}.lock`;
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  await open(target, "a", 0o600)
    .then((handle) => handle.close())
    .catch(() => undefined);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* The peer removed the lock between our mkdir and stat. */
      }
      if (Date.now() >= deadline) throw new Error(LOCKED);
      await sleep(50);
    }
  }
  try {
    return await run();
  } finally {
    await rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function refreshFileCredential(
  credential: KimiCredential,
  config: KimiConfig,
): Promise<KimiCredential> {
  const path = credential.path;
  if (!path) throw new Error(UNAVAILABLE);
  try {
    return await withRefreshLock(basename(path, ".json"), async () => {
      const onDisk = await readCredentialFile(path, config);
      let active = credential;
      if (onDisk.refreshToken !== credential.refreshToken) {
        /* The CLI refreshed while we waited; its rotated pair is authoritative. */
        if (!needsRefresh(onDisk)) return onDisk;
        active = onDisk;
      }
      const fresh = await requestRefresh(active);
      const raw: Record<string, unknown> = {
        ...active.raw,
        access_token: fresh.accessToken,
        refresh_token: fresh.refreshToken ?? active.refreshToken,
        expires_at: fresh.expiresAt,
        expires_in: fresh.expiresIn,
        token_type: fresh.tokenType ?? active.raw.token_type ?? "Bearer",
      };
      if (fresh.scope) raw.scope = fresh.scope;
      await writeCredential(path, raw);
      return {
        ...active,
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken ?? active.refreshToken,
        expiresAt: fresh.expiresAt,
        expiresIn: fresh.expiresIn,
        raw,
      };
    });
  } catch (error) {
    /* A peer may have rotated the token while we waited for the lock or the request. */
    const onDisk = await readCredentialFile(path, config).catch(() => null);
    if (onDisk && !needsRefresh(onDisk)) return onDisk;
    throw error;
  }
}

const globalState = globalThis as typeof globalThis & {
  projectorKimiEnvCredential?: { raw: string; credential: KimiCredential };
};

async function readAccessToken(forceRefresh: boolean): Promise<string> {
  const override = process.env.KIMI_AUTH_CONTENT;
  if (override !== undefined) {
    const configuration = await readKimiConfig();
    const cached = globalState.projectorKimiEnvCredential;
    const credential =
      cached?.raw === override ? cached.credential : parseCredential(override, null, configuration);
    if (!credential) throw new Error(UNAVAILABLE);
    if (!forceRefresh && !needsRefresh(credential)) return credential.accessToken;
    const fresh = await requestRefresh(credential);
    const next: KimiCredential = {
      ...credential,
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken ?? credential.refreshToken,
      expiresAt: fresh.expiresAt,
      expiresIn: fresh.expiresIn,
      raw: credential.raw,
    };
    globalState.projectorKimiEnvCredential = { raw: override, credential: next };
    return next.accessToken;
  }

  const config = await readKimiConfig();
  if (config.storage && config.storage !== "file") throw new Error(UNSUPPORTED_STORAGE);
  const paths = await credentialPaths(config);
  let credential: KimiCredential | null = null;
  for (const path of paths) {
    const raw = await readFile(path, "utf8").catch(() => null);
    if (raw === null) continue;
    credential = parseCredential(raw, path, config);
    if (credential) break;
  }
  if (!credential) throw new Error(UNAVAILABLE);
  if (!forceRefresh && !needsRefresh(credential)) return credential.accessToken;
  const refreshed = await refreshFileCredential(credential, config);
  return refreshed.accessToken;
}

/**
 * Read the Kimi Code CLI OAuth credentials and refresh them when the short-lived access token
 * nears expiry. Never publishes the credential files; writes only the rotated pair back.
 */
export async function readKimiAccessToken(forceRefresh = false): Promise<string> {
  return readAccessToken(forceRefresh);
}
