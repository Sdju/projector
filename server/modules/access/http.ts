import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { readNetworkMode } from "../../../core/modules/app-paths/index.ts";
import { accessAllowed, isLocalRequest, isTrustedHost } from "./access.ts";
import { hasLanPassword } from "./password.ts";
import { rememberLanSession } from "./session.ts";

/** Shared boundary for API and Vite/static resources. */
export function authorizeHttp(
  req: IncomingMessage,
  res: ServerResponse,
  allowLogin = false,
): boolean {
  if (accessAllowed(req, false)) {
    try {
      if (!isLocalRequest(req)) rememberLanSession(req, res);
    } catch {
      res.writeHead(503).end();
      return false;
    }
    return true;
  }
  const scheme = "encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:";
  const originAllowed =
    !req.headers.origin || req.headers.origin === `${scheme}//${req.headers.host}`;
  let status = 403;
  if (readNetworkMode() === "lan" && !isLocalRequest(req) && isTrustedHost(req) && originAllowed) {
    try {
      if (hasLanPassword()) status = 401;
    } catch {
      status = 503;
    }
  }
  res.setHeader("Cache-Control", "no-store");
  if (
    status === 401 &&
    allowLogin &&
    req.method === "GET" &&
    req.headers.accept?.includes("text/html")
  ) {
    sendLogin(res);
  } else {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: status === 503 ? "Не удалось прочитать пароль LAN" : "Доступ запрещён",
      }),
    );
  }
  return false;
}

function sendLogin(res: ServerResponse): void {
  const nonce = randomBytes(16).toString("base64");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
  });
  res.end(`<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projector — вход</title>
<style nonce="${nonce}">body{background:#151515;color:#eee;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0}form{width:min(320px,85vw);display:grid;gap:16px}h1{font-size:24px;margin:0}input,button{font:inherit;padding:10px;border:1px solid #555;border-radius:6px;background:#252525;color:inherit}p{min-height:1.5em;margin:0;color:#ef9999}</style>
<form><h1>Projector</h1><label for="password">Пароль доступа</label><input id="password" type="password" maxlength="1024" autocomplete="current-password" required autofocus><button>Войти</button><p role="alert"></p></form>
<script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const input=document.querySelector('input');const button=document.querySelector('button');const error=document.querySelector('p');button.disabled=true;error.textContent='';try{const response=await fetch('/api/app/network',{headers:{Authorization:'Bearer '+input.value}});if(!response.ok)throw new Error(response.status===401?'Неверный пароль':'Доступ запрещён');input.value='';location.reload()}catch(e){error.textContent=e.message;button.disabled=false}})</script></html>`);
}
