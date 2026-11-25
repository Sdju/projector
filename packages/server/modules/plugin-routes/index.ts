import type { IncomingMessage, ServerResponse } from "node:http";
import { addRoute, createRouter, findRoute, removeRoute, type RouterContext } from "rou3";
import {
  isPluginHttpPath,
  pluginBasePath,
  pluginHttpAccessOf,
  pluginHttpMethodsOf,
  pluginHttpPath,
  type PluginHttpAccess,
  type PluginHttpContribution,
  type PluginHttpMethod,
} from "@ai-projector/core/modules/plugins/index.ts";
import { accessAllowed } from "../access/index.ts";
import { HttpError } from "../http/index.ts";

/** Default for the body helper; a handler may pass a larger `maxBytes` or read `req` itself. */
export const PLUGIN_ROUTE_BODY_DEFAULT = 4 * 1024 * 1024;

export interface PluginHttpContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  /** Relative path pattern as declared in `contributes.http`. */
  path: string;
  /** Captures of the rou3 pattern (`:id`, `*`, `**`). */
  params: Readonly<Record<string, string>>;
  /** Aborted when the client disconnects or the handler finishes. */
  signal: AbortSignal;
  header(name: string): string | undefined;
  readBody(maxBytes?: number): Promise<Buffer>;
  readJson(maxBytes?: number): Promise<unknown>;
  json(status: number, body: unknown): void;
}

export type PluginHttpHandler = (context: PluginHttpContext) => void | Promise<void>;

export interface PluginRouteRegistration {
  /** Must match a `contributes.http[].id` entry of the package. */
  id: string;
  handle: PluginHttpHandler;
}

export interface PluginHttpRoute {
  plugin: string;
  id: string;
  path: string;
  url: string;
  methods: PluginHttpMethod[];
  access: PluginHttpAccess;
  handle: PluginHttpHandler;
}

interface RegisteredRoute {
  route: PluginHttpRoute;
  pattern: string;
  methods: PluginHttpMethod[];
}

interface Registry {
  router: RouterContext<PluginHttpRoute>;
  /** Path-only lookup for a 405 response with `Allow`. */
  paths: RouterContext<PluginHttpRoute>;
  entries: Map<string, RegisteredRoute>;
}

const host = globalThis as typeof globalThis & { projectorPluginRoutes?: Registry };

function emptyRegistry(): Registry {
  return { router: createRouter(), paths: createRouter(), entries: new Map() };
}

/**
 * The registry lives on `globalThis` so Vite reloads keep the routes. A reload can also meet an
 * object left by an older revision of this module, and its shape is not trustworthy: reading
 * `entries` from it failed every discovery with `state.entries is not iterable`. Rebuild such a
 * registry instead of trusting it; the old routers stop being reachable with it.
 */
const registry = (): Registry => {
  const current = host.projectorPluginRoutes;
  if (current?.router && current.paths && current.entries instanceof Map) return current;
  const fresh = emptyRegistry();
  host.projectorPluginRoutes = fresh;
  return fresh;
};

/**
 * `/api/plugins/<package-key>/<pattern>` for a user plugin and
 * `/api/projects/<project-key>/plugins/<package-key>/<pattern>` for a project one. The package
 * never supplies its own prefix.
 */
export function pluginRouteUrl(plugin: string, path: string): string {
  if (!isPluginHttpPath(path)) throw new Error("Небезопасный путь маршрута плагина");
  return `${pluginBasePath(plugin)}/${path}`;
}

export function beginPluginRoutes(plugin: string): void {
  dropPluginRoutes(plugin);
}

export function addPluginRoute(
  plugin: string,
  declaration: PluginHttpContribution,
  handle: PluginHttpHandler,
): void {
  const state = registry();
  const path = pluginHttpPath(declaration);
  const pattern = pluginRouteUrl(plugin, path);
  const key = `${plugin}\n${declaration.id}`;
  if (state.entries.has(key)) throw new Error(`Маршрут ${declaration.id} уже зарегистрирован`);
  const route: PluginHttpRoute = {
    plugin,
    id: declaration.id,
    path,
    url: pattern,
    methods: pluginHttpMethodsOf(declaration),
    access: pluginHttpAccessOf(declaration),
    handle,
  };
  try {
    for (const method of route.methods) addRoute(state.router, method, pattern, route);
    addRoute(state.paths, "", pattern, route);
  } catch (error) {
    // A pattern that rou3 rejects must not leave half of its method routes behind.
    for (const method of route.methods) {
      try {
        removeRoute(state.router, method, pattern);
      } catch {
        // The pattern itself is invalid; nothing was added for this method.
      }
    }
    try {
      removeRoute(state.paths, "", pattern);
    } catch {
      // Same as above for the path-only fallback.
    }
    const message = error instanceof Error ? error.message : "некорректный шаблон";
    throw new Error(`Маршрут ${declaration.id}: ${message}`);
  }
  state.entries.set(key, { route, pattern, methods: route.methods });
}

export function registeredPluginRouteIds(plugin: string): Set<string> {
  const ids = new Set<string>();
  for (const entry of registry().entries.values())
    if (entry.route.plugin === plugin) ids.add(entry.route.id);
  return ids;
}

export function dropPluginRoutes(plugin: string): void {
  const state = registry();
  for (const [key, entry] of state.entries) {
    if (entry.route.plugin !== plugin) continue;
    for (const method of entry.methods) {
      try {
        removeRoute(state.router, method, entry.pattern);
      } catch {
        // An invalid pattern was never added; clearing the entry is enough.
      }
    }
    try {
      removeRoute(state.paths, "", entry.pattern);
    } catch {
      // Same as above.
    }
    state.entries.delete(key);
  }
}

/** Test and HMR reset: the registry is rebuilt from the catalog on the next discovery. */
export function clearPluginRoutes(): void {
  const state = registry();
  state.router = createRouter();
  state.paths = createRouter();
  state.entries.clear();
}

export function pluginRoutePlugins(): Set<string> {
  return new Set([...registry().entries.values()].map((entry) => entry.route.plugin));
}

function allowedMethodsOf(route: PluginHttpRoute): PluginHttpMethod[] {
  if (!route.methods.includes("GET") || route.methods.includes("HEAD")) return route.methods;
  return [...route.methods, "HEAD"];
}

function readBody(req: IncomingMessage, maxBytes = PLUGIN_ROUTE_BODY_DEFAULT): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    return Promise.reject(new HttpError(413, "Тело запроса плагина слишком большое"));
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const fail = (error: Error) => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", fail);
      // Drain the rest so a keep-alive connection is not left half-read after 413.
      req.resume();
      rejectBody(error);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new HttpError(413, "Тело запроса плагина слишком большое"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", fail);
      resolveBody(Buffer.concat(chunks));
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", fail);
  });
}

function headerOf(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function contextFor(
  route: PluginHttpRoute,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string,
  params: Readonly<Record<string, string>>,
  signal: AbortSignal,
): PluginHttpContext {
  return {
    req,
    res,
    url,
    method,
    path: route.path,
    params,
    signal,
    header: (name) => headerOf(req, name),
    readBody: (maxBytes) => readBody(req, maxBytes),
    async readJson(maxBytes) {
      const body = await readBody(req, maxBytes);
      if (!body.length) return undefined;
      try {
        return JSON.parse(body.toString("utf8")) as unknown;
      } catch {
        throw new HttpError(400, "Тело запроса плагина не является JSON");
      }
    },
    json(status, body) {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.end(JSON.stringify(body));
    },
  };
}

async function dispatchMatch(
  route: PluginHttpRoute,
  params: Readonly<Record<string, string>>,
  context: { req: IncomingMessage; res: ServerResponse; url: URL },
  method: string,
): Promise<boolean> {
  const { req, res } = context;
  if (!accessAllowed(req, route.access === "local" ? false : method !== "GET" && method !== "HEAD"))
    throw new HttpError(403, "Маршрут плагина доступен только со страницы Projector");
  const controller = new AbortController();
  const abort = () => controller.abort();
  res.once("close", abort);
  try {
    await route.handle(contextFor(route, req, res, context.url, method, params, controller.signal));
  } catch (error) {
    if (res.writableEnded || res.destroyed) return true;
    throw error;
  } finally {
    res.off("close", abort);
    controller.abort();
  }
  if (!res.writableEnded) {
    res.statusCode = 204;
    res.end();
  }
  return true;
}

/**
 * Serves a declared plugin route through the same rou3 matcher as the built-in API, so static
 * segments win over `:params` and `*` wildcards. Built-in routes are dispatched first, and every
 * plugin pattern is anchored under its own `/api/plugins/<key>/` prefix.
 */
export async function handlePluginRoute(context: {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
}): Promise<boolean> {
  const state = registry();
  const method = context.method.toUpperCase();
  const match =
    findRoute(state.router, method, context.url.pathname) ??
    (method === "HEAD" ? findRoute(state.router, "GET", context.url.pathname) : undefined);
  if (match) return dispatchMatch(match.data, match.params ?? {}, context, method);

  const other = findRoute(state.paths, "", context.url.pathname);
  if (!other) return false;
  const { res } = context;
  res.setHeader("Allow", allowedMethodsOf(other.data).join(", "));
  res.setHeader("Cache-Control", "no-store");
  res.statusCode = 405;
  res.end(JSON.stringify({ error: "Метод не поддерживается" }));
  return true;
}
