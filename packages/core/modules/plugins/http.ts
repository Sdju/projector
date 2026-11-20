/**
 * Declarative HTTP routes of a trusted server plugin. A route is served under
 * `/api/plugins/<package-key>/<path>`; the handler is registered by the package code through
 * `api.http.register({ id, handle })` and must match an entry of `contributes.http`.
 */

export type PluginHttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS";

export const pluginHttpMethods: readonly PluginHttpMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
];

export type PluginHttpAccess = "projector" | "local";

export interface PluginHttpContribution {
  /** Route id the package code registers; unique inside one package. */
  id: string;
  /** Relative path under the package prefix; defaults to `id`. */
  path?: string;
  /** Allowed methods; defaults to `GET`. */
  methods?: PluginHttpMethod[];
  /**
   * `projector` (default) requires `Origin` for mutations, like the rest of the API.
   * `local` relies on the base loopback/LAN check and lets local services or webhooks call
   * the route without `Origin`; the plugin verifies its own signature.
   */
  access?: PluginHttpAccess;
}

const routeIdPattern = /^[a-z0-9][a-z0-9._-]*$/;

/** Effective relative path of a declared route; the id is the default. */
export function pluginHttpPath(route: PluginHttpContribution): string {
  return route.path ?? route.id;
}

/** Effective methods of a declared route; an omitted list means a read-only route. */
export function pluginHttpMethodsOf(route: PluginHttpContribution): PluginHttpMethod[] {
  return route.methods?.length ? route.methods : ["GET"];
}

/** Mutations are same-origin by default; a local route opts out of the extra Origin check. */
export function pluginHttpAccessOf(route: PluginHttpContribution): PluginHttpAccess {
  return route.access ?? "projector";
}

/**
 * A route path is a rou3 pattern under the package prefix: static segments, `:param`, `*`,
 * `**`, groups and regex constraints are all allowed. Dot segments, explicit percent escapes,
 * query/fragment delimiters and control characters are rejected because the URL parser resolves
 * or drops them before routing, so the declared pattern would mean something else.
 */
export function isPluginHttpPath(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false;
  if (value.includes("#")) return false;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const character = value[index]!;
    // Inside `(...)` a backslash escapes regex syntax; a literal backslash outside is rejected
    // because the URL parser would turn it into `/`.
    if (depth > 0 && character === "\\") {
      index++;
      continue;
    }
    if (depth === 0 && (character === "\\" || character === "%")) return false;
    if (character === "(") depth++;
    else if (character === ")") {
      depth--;
      if (depth < 0) return false;
    }
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (depth !== 0) return false;
  if (value.startsWith("/") || value.endsWith("/")) return false;
  const segments = value.split("/");
  return segments.every((segment) => !!segment && segment !== "." && segment !== "..");
}

export function validateHttpContributions(value: unknown): PluginHttpContribution[] {
  if (!Array.isArray(value)) throw new Error("projector.contributes.http должен быть массивом");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry))
      throw new Error("Маршрут плагина должен быть объектом");
    const route = entry as Record<string, unknown>;
    for (const key of Object.keys(route))
      if (!["id", "path", "methods", "access"].includes(key))
        throw new Error(`Маршрут плагина: неизвестные поля (${key})`);
    if (typeof route.id !== "string" || !routeIdPattern.test(route.id))
      throw new Error("Некорректный идентификатор маршрута плагина");
    if (ids.has(route.id)) throw new Error(`Повторяющийся идентификатор маршрута: ${route.id}`);
    ids.add(route.id);
    if (route.path !== undefined && !isPluginHttpPath(route.path))
      throw new Error(`Небезопасный путь маршрута плагина: ${route.id}`);
    const path = typeof route.path === "string" ? route.path : route.id;
    if (path === "storage" || path === "readme" || path.startsWith("readme/"))
      throw new Error(`Маршрут ${route.id}: путь ${path} зарезервирован`);
    if (paths.has(path)) throw new Error(`Повторяющийся путь маршрута плагина: ${path}`);
    paths.add(path);
    if (route.methods !== undefined) {
      if (!Array.isArray(route.methods) || !route.methods.length)
        throw new Error(`Маршрут ${route.id}: methods должен быть непустым массивом`);
      const methods = new Set<string>();
      for (const method of route.methods) {
        if (typeof method !== "string" || !pluginHttpMethods.includes(method as PluginHttpMethod))
          throw new Error(`Маршрут ${route.id}: недопустимый метод ${String(method)}`);
        if (methods.has(method))
          throw new Error(`Маршрут ${route.id}: повторяющийся метод ${method}`);
        methods.add(method);
      }
    }
    if (route.access !== undefined && route.access !== "projector" && route.access !== "local")
      throw new Error(`Маршрут ${route.id}: недопустимый режим доступа`);
  }
  return value as PluginHttpContribution[];
}
