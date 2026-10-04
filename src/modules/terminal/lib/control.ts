import type {
  TerminalSession,
  TerminalControlMessage,
  TerminalControlRequest,
} from "../../../../core/modules/terminal/index.ts";
import { lanPassword } from "../../../common/utilities/lan-auth.ts";

export class TerminalRequestError extends Error {
  readonly session?: TerminalSession;
  constructor(message: string, session?: TerminalSession) {
    super(message);
    this.session = session;
  }
}

type Listener = (sessions: TerminalSession[]) => void;
class TerminalControl {
  private socket?: WebSocket;
  private reconnect?: ReturnType<typeof setTimeout>;
  private delay = 500;
  private nextId = 0;
  private listeners = new Set<Listener>();
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private connecting?: Promise<void>;
  private cancelConnect?: (error: Error) => void;
  private snapshot?: TerminalSession[];
  readonly projectId: string;
  constructor(projectId: string) {
    this.projectId = projectId;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    if (this.snapshot) listener(this.snapshot);
    void this.connect().catch(() => {});
    return () => {
      this.listeners.delete(listener);
      this.release();
    };
  }

  private release() {
    if (this.listeners.size || this.pending.size) return;
    clearTimeout(this.reconnect);
    this.reconnect = undefined;
    const socket = this.socket;
    this.socket = undefined;
    this.cancelConnect?.(new Error("Подписка на терминалы закрыта"));
    socket?.close();
    if (connections.get(this.projectId) === this) connections.delete(this.projectId);
  }

  private connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    clearTimeout(this.reconnect);
    const url = new URL("/api/terminal/control", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("project", this.projectId);
    const token = lanPassword();
    if (token) url.searchParams.set("token", token);
    const socket = (this.socket = new WebSocket(url));
    this.connecting = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Терминалы не ответили"));
        socket.close();
      }, 10000);
      this.cancelConnect = reject;
      socket.onopen = () => {
        clearTimeout(timer);
        this.delay = 500;
        resolve();
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket) return;
        const message = JSON.parse(event.data) as TerminalControlMessage;
        if (message.type === "sessions") {
          this.snapshot = message.sessions;
          for (const listener of this.listeners) listener(message.sessions);
        } else if (message.type === "response") {
          const request = this.pending.get(message.id);
          if (!request) return;
          clearTimeout(request.timer);
          this.pending.delete(message.id);
          if (message.data.error)
            request.reject(new TerminalRequestError(message.data.error, message.data.session));
          else request.resolve(message.data);
          this.release();
        }
      };
      socket.onclose = () => {
        clearTimeout(timer);
        reject(new Error("Соединение с терминалами потеряно"));
        if (this.socket !== socket) return;
        this.socket = undefined;
        this.snapshot = undefined;
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error("Соединение потеряно; проверьте результат операции"));
        }
        this.pending.clear();
        if (this.listeners.size) {
          this.reconnect = setTimeout(() => void this.connect().catch(() => {}), this.delay);
          this.delay = Math.min(this.delay * 2, 10000);
        } else this.release();
      };
    }).finally(() => {
      this.connecting = undefined;
      this.cancelConnect = undefined;
    });
    return this.connecting;
  }

  async request<T>(suffix: string, init?: RequestInit): Promise<T> {
    try {
      await this.connect();
    } catch (error) {
      this.release();
      throw error;
    }
    const url = new URL(suffix || "/", location.href);
    const sessionId = decodeURIComponent(url.pathname.replace(/^\//, "")) || undefined;
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Терминалы не ответили; проверьте результат операции"));
        this.release();
      }, 15000);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer });
      this.socket!.send(
        JSON.stringify({
          id,
          method: (init?.method ?? "GET") as TerminalControlRequest["method"],
          sessionId,
          body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
          link: url.searchParams.get("link") ?? undefined,
        } satisfies TerminalControlRequest),
      );
    });
  }
}
const connections = new Map<string, TerminalControl>();
function connection(projectId: string): TerminalControl {
  let control = connections.get(projectId);
  if (!control) {
    control = new TerminalControl(projectId);
    connections.set(projectId, control);
  }
  return control;
}
export const subscribeTerminalSessions = (projectId: string, listener: Listener): (() => void) =>
  connection(projectId).subscribe(listener);
export const terminalRequest = <T>(
  projectId: string,
  suffix = "",
  init?: RequestInit,
): Promise<T> => connection(projectId).request<T>(suffix, init);
