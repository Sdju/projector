import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { lanPasswordVersion } from "./password.ts";

const COOKIE = "projector_lan";
const LIFETIME = 8 * 60 * 60 * 1000;
interface LanSession {
  version: string;
  expires: number;
}
const host = globalThis as typeof globalThis & { projectorLanSessions?: Map<string, LanSession> };
const sessions = (host.projectorLanSessions ??= new Map());

export function validLanSession(req: IncomingMessage): boolean {
  const id = req.headers.cookie?.match(/(?:^|;\s*)projector_lan=([a-f0-9]{64})(?:;|$)/)?.[1];
  const session = id ? sessions.get(id) : undefined;
  if (!session) return false;
  if (session.expires <= Date.now() || session.version !== lanPasswordVersion()) {
    sessions.delete(id!);
    return false;
  }
  return true;
}

/** Call only after the request's Bearer password has been verified. */
export function rememberLanSession(req: IncomingMessage, res: ServerResponse): void {
  if (
    res.hasHeader("Set-Cookie") ||
    !req.headers.authorization?.startsWith("Bearer ") ||
    validLanSession(req)
  )
    return;
  const version = lanPasswordVersion();
  if (!version) return;
  for (const [id, session] of sessions) {
    if (session.expires <= Date.now() || session.version !== version) sessions.delete(id);
  }
  // Bound memory even when a client authenticates without keeping its cookies.
  if (sessions.size >= 256) sessions.delete(sessions.keys().next().value!);
  const id = randomBytes(32).toString("hex");
  sessions.set(id, { version, expires: Date.now() + LIFETIME });
  const secure = "encrypted" in req.socket && req.socket.encrypted ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${LIFETIME / 1000}${secure}`,
  );
}
