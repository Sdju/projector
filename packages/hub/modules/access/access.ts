import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { hubDataDir, RefreshStore } from "./store.ts";

const digest = (value: string) => createHash("sha256").update(value).digest();
const LIFETIME = 8 * 60 * 60 * 1000;
const REFRESH_AGE = 30 * 24 * 60 * 60;
const LINK_TTL = 60_000;
const LINK_LIMIT = 8;
const LOGIN_CODE = /^[a-f0-9]{64}$/;
interface Connection {
  destroy(): unknown;
  once(event: "close", callback: () => void): unknown;
}
interface Session {
  expires: number;
  connections: Set<Connection>;
  timer: ReturnType<typeof setTimeout>;
}
interface Ticket {
  expires: number;
  timer: ReturnType<typeof setTimeout>;
}
const json = (res: ServerResponse, status: number, value: object) =>
  res
    .writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    .end(JSON.stringify(value));
export class HubAccess {
  private sessions = new Map<string, Session>();
  private attempts = new Map<string, { count: number; until: number }>();
  private tickets = new Map<string, Ticket>();
  private bound = new WeakMap<IncomingMessage, string>();
  private store: RefreshStore;
  private password: Buffer;
  readonly origin: string;
  constructor(origin: string, password: string, dataDir = hubDataDir()) {
    this.origin = origin;
    this.password = digest(password);
    this.store = new RefreshStore(join(dataDir, "refresh.json"), this.password.toString("hex"));
  }
  trusted(req: IncomingMessage): boolean {
    return (
      req.headers.host === new URL(this.origin).host &&
      (!req.headers.origin || req.headers.origin === this.origin)
    );
  }
  private sessionId(req: IncomingMessage): string {
    return (
      this.bound.get(req) ??
      req.headers.cookie?.match(/(?:^|;\s*)projector_hub=([a-f0-9]{64})(?:;|$)/)?.[1] ??
      ""
    );
  }
  private refreshId(req: IncomingMessage): string {
    return req.headers.cookie?.match(/(?:^|;\s*)projector_hub_rt=([a-f0-9]{64})(?:;|$)/)?.[1] ?? "";
  }
  allowed(req: IncomingMessage): boolean {
    return this.trusted(req) && (this.sessions.get(this.sessionId(req))?.expires ?? 0) > Date.now();
  }
  /** Restores an expired session from a rotating refresh cookie and binds it to this request. */
  allow(req: IncomingMessage, res: ServerResponse): boolean {
    if (this.allowed(req)) return true;
    if (!this.trusted(req)) return false;
    const rotated = this.store.consume(this.refreshId(req));
    if (!rotated) return false;
    this.issue(req, res, rotated);
    return true;
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
  private cookie(name: string, value: string, maxAge: number): string {
    return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${this.origin.startsWith("https:") ? "; Secure" : ""}`;
  }
  private setCookies(res: ServerResponse, session: string, refresh: string): void {
    res.setHeader("Set-Cookie", [
      this.cookie("projector_hub", session, session ? LIFETIME / 1000 : 0),
      this.cookie("projector_hub_rt", refresh, refresh ? REFRESH_AGE : 0),
    ]);
  }
  private dropTicket(id: string): void {
    const ticket = this.tickets.get(id);
    if (!ticket) return;
    clearTimeout(ticket.timer);
    this.tickets.delete(id);
  }
  private consumeTicket(code: string): boolean {
    if (!LOGIN_CODE.test(code)) return false;
    const id = digest(code).toString("hex");
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires <= Date.now()) {
      this.dropTicket(id);
      return false;
    }
    this.dropTicket(id);
    return true;
  }
  private issue(
    req: IncomingMessage,
    res: ServerResponse,
    refresh: { token: string; family: string },
  ): void {
    for (const [id, session] of this.sessions) if (session.expires <= Date.now()) this.revoke(id);
    this.revoke(this.sessionId(req));
    if (this.sessions.size >= 256) this.revoke(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString("hex");
    const timer = setTimeout(() => this.revoke(id), LIFETIME);
    timer.unref();
    this.sessions.set(id, { expires: Date.now() + LIFETIME, connections: new Set(), timer });
    this.bound.set(req, id);
    this.setCookies(res, id, refresh.token);
  }
  private establish(req: IncomingMessage, res: ServerResponse, redirect: boolean): void {
    this.store.revoke(this.refreshId(req));
    this.issue(req, res, this.store.issue());
    if (redirect) res.writeHead(303, { Location: "/", "Cache-Control": "no-store" }).end();
    else json(res, 200, { authenticated: true });
  }
  /** Short-lived one-time URL for a phone camera; the code is not the browser password. */
  issueLoginLink(): { url: string; ttl: number } {
    for (const [id, ticket] of this.tickets) if (ticket.expires <= Date.now()) this.dropTicket(id);
    if (this.tickets.size >= LINK_LIMIT) {
      let oldest = "";
      let soonest = Infinity;
      for (const [id, ticket] of this.tickets)
        if (ticket.expires < soonest) {
          soonest = ticket.expires;
          oldest = id;
        }
      this.dropTicket(oldest);
    }
    const code = randomBytes(32).toString("hex");
    const id = digest(code).toString("hex");
    const timer = setTimeout(() => this.dropTicket(id), LINK_TTL);
    timer.unref();
    this.tickets.set(id, { expires: Date.now() + LINK_TTL, timer });
    return { url: `${this.origin}/login?code=${code}`, ttl: LINK_TTL / 1000 };
  }
  logout(req: IncomingMessage, res: ServerResponse): void {
    this.revoke(this.sessionId(req));
    this.store.revoke(this.refreshId(req));
    this.setCookies(res, "", "");
    json(res, 200, { authenticated: false });
  }
  async login(req: IncomingMessage, res: ServerResponse, redirect = false): Promise<void> {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) {
        json(res, 413, { error: "Слишком большой запрос" });
        return;
      }
    }
    let password: unknown;
    let code: unknown;
    try {
      if (req.headers["content-type"]?.startsWith("application/json")) {
        const parsed = JSON.parse(body) as { password?: unknown; code?: unknown };
        password = parsed.password;
        code = parsed.code;
      } else {
        const params = new URLSearchParams(body);
        password = params.get("password");
        code = params.get("code");
      }
    } catch {
      json(res, 400, { error: "Некорректный запрос" });
      return;
    }
    if (typeof code === "string" && code) {
      if (!this.consumeTicket(code)) {
        json(res, 401, { error: "Ссылка входа недействительна или истекла" });
        return;
      }
      this.establish(req, res, redirect);
      return;
    }
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
    if (typeof password !== "string" || !timingSafeEqual(digest(password), this.password)) {
      json(res, 401, { error: "Неверный пароль" });
      return;
    }
    this.attempts.delete(key);
    this.establish(req, res, redirect);
  }
  close(): void {
    for (const id of this.sessions.keys()) this.revoke(id);
    for (const id of this.tickets.keys()) this.dropTicket(id);
  }
}
