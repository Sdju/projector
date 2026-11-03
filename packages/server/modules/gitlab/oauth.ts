import { randomUUID } from "node:crypto";
import { HttpError } from "../http/index.ts";
import {
  fieldText as text,
  integrationConfig,
  updateIntegration,
} from "../integration-store/index.ts";
import { gitlabBaseUrl } from "./base.ts";

const DEVICE_SCOPE = "read_api read_repository read_user";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const REFRESH_MARGIN = 60_000;
const SESSION_EXPIRED = "Сессия GitLab истекла. Войдите снова";

interface DeviceSession {
  id: string;
  base: string;
  clientId: string;
  deviceCode: string;
  expiresAt: number;
  interval: number;
  nextPoll: number;
}
const sessions = new Map<string, DeviceSession>();
const refreshes = new Map<string, Promise<string>>();

interface OauthResponse {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

/** Form-urlencoded OAuth request; the body and redirects never leave the configured instance. */
async function oauthRequest(
  base: string,
  path: string,
  form: Record<string, string>,
): Promise<OauthResponse> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "Projector",
      },
      body: new URLSearchParams(form),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "GitLab недоступен. Проверьте адрес и сеть");
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed = (await response.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      data = parsed as Record<string, unknown>;
  } catch {
    // An empty or non-JSON body is reported by the caller with the status.
  }
  return { ok: response.ok, status: response.status, data };
}

function stringField(data: Record<string, unknown>, name: string): string {
  const value = data[name];
  return typeof value === "string" ? value : "";
}

async function oauthUser(base: string, token: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`${base}/api/v4/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": "Projector",
      },
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch {
    throw new HttpError(400, "GitLab недоступен. Проверьте адрес и сеть");
  }
  if (!response.ok)
    throw new HttpError(401, "Авторизация GitLab истекла или недействительна. Войдите снова");
  const user = (await response.json()) as { username?: unknown };
  if (typeof user.username !== "string" || !user.username)
    throw new HttpError(400, "GitLab не подтвердил вход. Попробуйте снова");
  return user.username;
}

function sameSettings(
  config: { enabled: boolean; settings: Record<string, string> },
  session: DeviceSession,
): boolean {
  return (
    config.enabled &&
    text(config.settings.clientId) === session.clientId &&
    gitlabBaseUrl(config.settings.url) === session.base
  );
}

export async function beginGitlabDeviceLogin() {
  const config = await integrationConfig("gitlab");
  const clientId = text(config.settings.clientId);
  if (!config.enabled || !clientId)
    throw new HttpError(
      400,
      "Включите GitLab и сохраните Client ID OAuth-приложения с Device Flow",
    );
  const base = gitlabBaseUrl(config.settings.url);
  const response = await oauthRequest(base, "/oauth/authorize_device", {
    client_id: clientId,
    scope: DEVICE_SCOPE,
  });
  const deviceCode = stringField(response.data, "device_code");
  const userCode = stringField(response.data, "user_code");
  const verificationUri = stringField(response.data, "verification_uri");
  if (!response.ok || response.data.error || !deviceCode || !userCode || !verificationUri)
    throw new HttpError(
      400,
      "Не удалось начать вход. Проверьте Client ID и Device Flow (GitLab 17.1+)",
    );
  sessions.clear();
  const session: DeviceSession = {
    id: randomUUID(),
    base,
    clientId,
    deviceCode,
    expiresAt: Date.now() + (Number(response.data.expires_in) || 300) * 1000,
    interval: Math.max(1, Number(response.data.interval) || 5),
    nextPoll: 0,
  };
  session.nextPoll = Date.now() + session.interval * 1000;
  sessions.set(session.id, session);
  return {
    id: session.id,
    userCode,
    verificationUri,
    expiresAt: session.expiresAt,
    interval: session.interval,
  };
}

export interface GitlabDevicePoll {
  pending: boolean;
  interval?: number;
}

/** One poll step; the status wrapper in `api.ts` adds the public integration state. */
export async function pollGitlabDevice(body: Record<string, unknown>): Promise<GitlabDevicePoll> {
  const session = sessions.get(text(body.id));
  if (!session || session.expiresAt <= Date.now()) {
    if (session) sessions.delete(session.id);
    throw new HttpError(400, "Код входа истёк. Начните авторизацию заново");
  }
  if (Date.now() < session.nextPoll)
    return {
      pending: true,
      interval: Math.max(1, Math.ceil((session.nextPoll - Date.now()) / 1000)),
    };
  const config = await integrationConfig("gitlab");
  if (!sameSettings(config, session)) {
    sessions.delete(session.id);
    throw new HttpError(400, "Настройки изменились. Начните авторизацию заново");
  }
  // Hold the slot while the request is in flight so double clicks cannot race.
  session.nextPoll = Date.now() + 30_000;
  const response = await oauthRequest(session.base, "/oauth/token", {
    client_id: session.clientId,
    device_code: session.deviceCode,
    grant_type: DEVICE_GRANT,
  });
  if (sessions.get(session.id) !== session) throw new HttpError(400, "Авторизация отменена");
  const error = stringField(response.data, "error");
  if (error === "authorization_pending" || error === "slow_down") {
    if (error === "slow_down") session.interval += 5;
    session.nextPoll = Date.now() + session.interval * 1000;
    return { pending: true, interval: session.interval };
  }
  const token = stringField(response.data, "access_token");
  if (!response.ok || error || !token) {
    sessions.delete(session.id);
    if (error === "expired_token")
      throw new HttpError(400, "Код входа истёк. Начните авторизацию заново");
    if (error === "access_denied") throw new HttpError(400, "Вход отменён в GitLab");
    throw new HttpError(400, "Не удалось завершить вход. Попробуйте снова");
  }
  const login = await oauthUser(session.base, token);
  if (sessions.get(session.id) !== session) throw new HttpError(400, "Авторизация отменена");
  const refreshToken = stringField(response.data, "refresh_token");
  const expiresAt = Date.now() + (Number(response.data.expires_in) || 7200) * 1000;
  await updateIntegration("gitlab", (current) => {
    if (!sameSettings(current, session) || sessions.get(session.id) !== session)
      throw new HttpError(400, "Настройки изменились. Начните авторизацию заново");
    return {
      ...current,
      credentials: {
        kind: "oauth",
        token,
        refreshToken,
        expiresAt: String(expiresAt),
        login,
      },
    };
  });
  sessions.clear();
  return { pending: false };
}

/** Drops pending device sessions; called when settings change or the integration is disconnected. */
export function clearGitlabSessions() {
  sessions.clear();
}

/** Refresh as soon as the access token is within a minute of expiry. */
export function gitlabTokenExpiring(credentials: Record<string, string>): boolean {
  if (credentials.kind !== "oauth" || !credentials.token) return false;
  const expiresAt = Number(credentials.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt - Date.now() < REFRESH_MARGIN;
}

/**
 * One refresh per instance: parallel tabs and requests share the same promise, so a rotated refresh
 * token is never used twice. A temporary network failure leaves the stored credentials intact.
 */
export function refreshGitlabToken(base: string, force = false): Promise<string> {
  const running = refreshes.get(base);
  if (running) return running;
  let task: Promise<string>;
  task = refreshGitlabTokenOnce(base, force).finally(() => {
    if (refreshes.get(base) === task) refreshes.delete(base);
  });
  refreshes.set(base, task);
  return task;
}

async function refreshGitlabTokenOnce(base: string, force: boolean): Promise<string> {
  const sessionExpired = () => new HttpError(401, SESSION_EXPIRED);
  const config = await integrationConfig("gitlab");
  if (
    !config.enabled ||
    gitlabBaseUrl(config.settings.url) !== base ||
    config.credentials.kind !== "oauth" ||
    !config.credentials.refreshToken
  )
    throw sessionExpired();
  // Another request may have refreshed it before this task started.
  if (!force && !gitlabTokenExpiring(config.credentials)) return config.credentials.token;
  const clientId = text(config.settings.clientId);
  if (!clientId) throw sessionExpired();
  let response: OauthResponse;
  try {
    response = await oauthRequest(base, "/oauth/token", {
      grant_type: "refresh_token",
      refresh_token: config.credentials.refreshToken,
      client_id: clientId,
    });
  } catch {
    throw sessionExpired();
  }
  const token = stringField(response.data, "access_token");
  if (!response.ok || response.data.error || !token) throw sessionExpired();
  const refreshToken =
    stringField(response.data, "refresh_token") || config.credentials.refreshToken;
  const expiresAt = Date.now() + (Number(response.data.expires_in) || 7200) * 1000;
  await updateIntegration("gitlab", (current) => {
    if (
      !current.enabled ||
      gitlabBaseUrl(current.settings.url) !== base ||
      current.credentials.kind !== "oauth" ||
      current.credentials.refreshToken !== config.credentials.refreshToken
    )
      throw sessionExpired();
    return {
      ...current,
      credentials: {
        ...current.credentials,
        kind: "oauth",
        token,
        refreshToken,
        expiresAt: String(expiresAt),
      },
    };
  });
  return token;
}
