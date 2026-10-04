import type { IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import { readNetworkMode } from "../../../core/modules/app-paths/index.ts";
import { hasLanPassword, verifyLanPassword } from "./password.ts";
import { validLanSession } from "./session.ts";

const LOOPBACK = ["localhost", "127.0.0.1", "[::1]"];
const loopbackAddresses = new BlockList();
loopbackAddresses.addSubnet("127.0.0.0", 8, "ipv4");
loopbackAddresses.addAddress("::1", "ipv6");

function hostname(req: IncomingMessage): string {
  try {
    const host = req.headers.host;
    if (!host) return "";
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return "";
    return url.hostname;
  } catch {
    return "";
  }
}

/** Numeric LAN addresses and localhost cannot be rebound by a third-party DNS owner. */
export function isTrustedHost(req: IncomingMessage): boolean {
  const host = hostname(req);
  return host === "localhost" || !!isIP(host.replace(/^\[|\]$/g, ""));
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
  const address = req.socket.remoteAddress;
  if (!address) return false;
  const family = isIP(address);
  return !!family && loopbackAddresses.check(address, family === 6 ? "ipv6" : "ipv4");
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
  const local = isLocalRequest(req);
  if (!isTrustedHost(req)) return false;
  // Host is a separate DNS rebinding guard, never proof of the client's address.
  if (readNetworkMode() === "local" && (!local || !LOOPBACK.includes(host))) return false;

  const origin = req.headers.origin;
  if (origin && origin !== `${scheme(req)}//${req.headers.host}`) return false;
  if (!origin && requireOrigin) return false;

  try {
    if (!local && hasLanPassword()) {
      if (validLanSession(req)) return true;
      const token = lanPassword(req, queryToken);
      if (!token || !verifyLanPassword(token)) return false;
    }
  } catch {
    // A damaged/unreadable credential file must never turn protected LAN into open LAN.
    return false;
  }
  return true;
}
