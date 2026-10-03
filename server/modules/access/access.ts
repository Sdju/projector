import type { IncomingMessage } from "node:http";
import { readNetworkMode } from "../../../core/modules/app-paths/index.ts";
import { hasLanPassword, verifyLanPassword } from "./password.ts";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];

function hostname(req: IncomingMessage): string {
  try {
    return new URL(`http://${req.headers.host}`).hostname;
  } catch {
    return "";
  }
}

function scheme(req: IncomingMessage): string {
  return "encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:";
}

/** Bearer-пароль из заголовка Authorization; `queryToken` — для WebSocket без заголовков. */
export function lanPassword(req: IncomingMessage, queryToken?: string): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return queryToken ?? null;
}

/** Запрос пришёл с loopback-интерфейса этой машины. */
export function isLocalRequest(req: IncomingMessage): boolean {
  return LOOPBACK.includes(hostname(req));
}

/**
 * Общий допуск к API. В local-режиме только loopback; в lan-режиме допускаются
 * сетевые клиенты, а при заданном пароле — только с корректным Bearer-токеном.
 * `requireOrigin` запрещает запросы без совпадающего заголовка Origin.
 */
export function accessAllowed(
  req: IncomingMessage,
  requireOrigin = true,
  queryToken?: string,
): boolean {
  const host = hostname(req);
  const local = LOOPBACK.includes(host);
  if (readNetworkMode() === "local" && !local) return false;

  const origin = req.headers.origin;
  if (origin && origin !== `${scheme(req)}//${req.headers.host}`) return false;
  if (!origin && requireOrigin) return false;

  if (!local && hasLanPassword()) {
    const token = lanPassword(req, queryToken);
    if (!token || !verifyLanPassword(token)) return false;
  }
  return true;
}
