import type { IncomingMessage, ServerResponse } from "node:http";
import type { RunnableDevEnvironment } from "vite-plus";
import type { RuntimeHandlers, RuntimeModule } from "./runtime-contract.ts";

interface Generation {
  module: RuntimeModule;
  handlers: RuntimeHandlers;
}

/** Owns one managed module graph, independently of how often API files change. */
export class DevRuntime {
  private active?: Generation;
  private loading?: Promise<Generation>;
  private revision = 0;
  private attempted = -1;
  private closed = false;
  private lastError?: string;
  private subscriptions?: () => void;
  private transports?: () => void;
  private replaceTransports = false;

  private environment: RunnableDevEnvironment;
  private entry: string;
  private report: (error: unknown) => void;
  private recovered: () => void;

  constructor(
    environment: RunnableDevEnvironment,
    entry: string,
    report: (error: unknown) => void,
    recovered: () => void,
  ) {
    this.environment = environment;
    this.entry = entry;
    this.report = report;
    this.recovered = recovered;
  }

  /** The same facade is retained by every socket; its target changes only after a valid load. */
  readonly handlers = (): RuntimeHandlers => {
    if (!this.active) throw new Error("Projector runtime is not active");
    return this.active.handlers;
  };

  async update(file: string): Promise<void> {
    this.revision++;
    if (
      /\/server\/modules\/(terminal|terminal-control)\/(socket|shared-socket)\.ts$/.test(file) ||
      file.endsWith("/server/modules/access/connections.ts")
    )
      this.replaceTransports = true;
    await this.load();
  }

  async start(server: import("vite").HttpServer | null): Promise<void> {
    const current = await this.load();
    this.transports = current.module.bindRuntime(server, "dev", this.handlers);
    server?.once("close", () => this.close());
    this.server = server;
  }

  private server: import("vite").HttpServer | null = null;

  private async loadOnce(): Promise<Generation> {
    if (this.closed) throw new Error("Projector runtime is closed");
    if (this.active && this.attempted === this.revision) return this.active;
    const epoch = this.revision;
    this.attempted = epoch;
    if (this.active) {
      this.environment.moduleGraph.invalidateAll();
      this.environment.runner.clearCache();
    }
    try {
      const module = (await this.environment.runner.import(this.entry)) as RuntimeModule;
      const next = { module, handlers: module.getRuntimeHandlers() };
      if (this.closed) throw new Error("Projector runtime is closed");
      if (epoch !== this.revision) {
        this.attempted = -1;
        return this.loadOnce();
      }
      if (this.active) {
        const dispose = module.bindRuntime(null, "dev");
        this.subscriptions?.();
        this.subscriptions = dispose;
      }
      this.active = next;
      if (this.replaceTransports && this.server) {
        this.transports?.();
        this.transports = module.bindRuntime(this.server, "dev", this.handlers);
        this.replaceTransports = false;
      }
      if (this.lastError) this.recovered();
      this.lastError = undefined;
      return next;
    } catch (error) {
      if (this.closed || !this.active) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (this.lastError !== message) this.report(error);
      this.lastError = message;
      if (epoch !== this.revision) {
        this.attempted = -1;
        return this.loadOnce();
      }
      return this.active;
    }
  }

  private load(): Promise<Generation> {
    return (this.loading ??= this.loadOnce().finally(() => {
      this.loading = undefined;
    }));
  }

  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void {
    // Only loading falls back. A failed operation is never retried against an older generation.
    void this.load()
      .then(({ handlers }) => handlers.handleHttp(req, res, next))
      .catch(() => {
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subscriptions?.();
    this.transports?.();
    this.subscriptions = this.transports = undefined;
    this.active = undefined;
    this.server = null;
  }
}
