import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const digest = (value: string) => createHash("sha256").update(value).digest();
export class HubAccess {
  private sessions = new Map<string, number>();
  private attempts = new Map<string, { count: number; until: number }>();
  private password: Buffer;
  readonly origin: string;
  constructor(origin: string, password: string) {
    this.origin = origin;
    this.password = digest(password);
  }
  trusted(req: IncomingMessage): boolean {
    return (
      req.headers.host === new URL(this.origin).host &&
      (!req.headers.origin || req.headers.origin === this.origin)
    );
  }
  allowed(req: IncomingMessage): boolean {
    if (!this.trusted(req)) return false;
    const id = req.headers.cookie?.match(/(?:^|;\s*)projector_hub=([a-f0-9]{64})(?:;|$)/)?.[1];
    return !!id && (this.sessions.get(id) ?? 0) > Date.now();
  }
  async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.trusted(req)) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      });
      res.end(
        '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Projector Hub</title><h1>Projector Hub</h1><form method="post" action="/login"><label>Пароль <input name="password" type="password" required autocomplete="current-password"></label><button>Войти</button></form></html>',
      );
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end();
      return;
    }
    const key = req.socket.remoteAddress ?? "unknown";
    for (const [id, attempt] of this.attempts)
      if (attempt.until <= Date.now()) this.attempts.delete(id);
    const attempt = this.attempts.get(key) ?? { count: 0, until: Date.now() + 60_000 };
    if (attempt.count >= 10 || this.attempts.size >= 1024) {
      res.writeHead(429).end();
      return;
    }
    attempt.count++;
    this.attempts.set(key, attempt);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) {
        res.writeHead(413).end();
        return;
      }
    }
    const value = new URLSearchParams(body).get("password") ?? "";
    if (!timingSafeEqual(digest(value), this.password)) {
      res.writeHead(401).end("Неверный пароль");
      return;
    }
    this.attempts.delete(key);
    for (const [id, expires] of this.sessions) if (expires <= Date.now()) this.sessions.delete(id);
    if (this.sessions.size >= 256) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    this.sessions.set(id, Date.now() + 8 * 60 * 60 * 1000);
    const secure = this.origin.startsWith("https:") ? "; Secure" : "";
    res
      .writeHead(303, {
        Location: "/",
        "Cache-Control": "no-store",
        "Set-Cookie": `projector_hub=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
      })
      .end();
  }
}
