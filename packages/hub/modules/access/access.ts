import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const digest = (value: string) => createHash("sha256").update(value).digest();
const LIFETIME = 8 * 60 * 60 * 1000;
interface Connection {
  destroy(): unknown;
  once(event: "close", callback: () => void): unknown;
}
interface Session {
  expires: number;
  connections: Set<Connection>;
  timer: ReturnType<typeof setTimeout>;
}
const json = (res: ServerResponse, status: number, value: object) =>
  res
    .writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    .end(JSON.stringify(value));
export class HubAccess {
  private sessions = new Map<string, Session>();
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
  private sessionId(req: IncomingMessage): string {
    return req.headers.cookie?.match(/(?:^|;\s*)projector_hub=([a-f0-9]{64})(?:;|$)/)?.[1] ?? "";
  }
  allowed(req: IncomingMessage): boolean {
    return this.trusted(req) && (this.sessions.get(this.sessionId(req))?.expires ?? 0) > Date.now();
  }
  track(req: IncomingMessage, connection: Connection): boolean {
    const session = this.sessions.get(this.sessionId(req));
    if (!session || session.expires <= Date.now()) {
      connection.destroy();
      return false;
    }
    session.connections.add(connection);
    connection.once("close", () => session.connections.delete(connection));
    return true;
  }
  private revoke(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    clearTimeout(session.timer);
    this.sessions.delete(id);
    for (const connection of session.connections) connection.destroy();
  }
  private cookie(id: string): string {
    return `projector_hub=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${id ? 28800 : 0}${this.origin.startsWith("https:") ? "; Secure" : ""}`;
  }
  logout(req: IncomingMessage, res: ServerResponse): void {
    this.revoke(this.sessionId(req));
    res.setHeader("Set-Cookie", this.cookie(""));
    json(res, 200, { authenticated: false });
  }
  async login(req: IncomingMessage, res: ServerResponse, redirect = false): Promise<void> {
    const key = req.socket.remoteAddress ?? "unknown";
    for (const [id, attempt] of this.attempts)
      if (attempt.until <= Date.now()) this.attempts.delete(id);
    const attempt = this.attempts.get(key) ?? { count: 0, until: Date.now() + 60_000 };
    if (attempt.count >= 10 || this.attempts.size >= 1024) {
      json(res, 429, { error: "Слишком много попыток. Повторите через минуту." });
      return;
    }
    attempt.count++;
    this.attempts.set(key, attempt);
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) {
        json(res, 413, { error: "Слишком большой запрос" });
        return;
      }
    }
    let value: unknown;
    try {
      value = req.headers["content-type"]?.startsWith("application/json")
        ? JSON.parse(body).password
        : new URLSearchParams(body).get("password");
    } catch {
      json(res, 400, { error: "Некорректный запрос" });
      return;
    }
    if (typeof value !== "string" || !timingSafeEqual(digest(value), this.password)) {
      json(res, 401, { error: "Неверный пароль" });
      return;
    }
    this.attempts.delete(key);
    for (const [id, session] of this.sessions) if (session.expires <= Date.now()) this.revoke(id);
    // Signing in again replaces the previous session of this browser.
    this.revoke(this.sessionId(req));
    if (this.sessions.size >= 256) this.revoke(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    const timer = setTimeout(() => this.revoke(id), LIFETIME);
    timer.unref();
    this.sessions.set(id, { expires: Date.now() + LIFETIME, connections: new Set(), timer });
    res.setHeader("Set-Cookie", this.cookie(id));
    if (redirect) res.writeHead(303, { Location: "/", "Cache-Control": "no-store" }).end();
    else json(res, 200, { authenticated: true });
  }
  close(): void {
    for (const id of this.sessions.keys()) this.revoke(id);
  }
}
