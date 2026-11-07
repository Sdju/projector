import { addRoute, createRouter, findRoute } from "rou3";
import type { RouteContext, RouteDefinition, RouteHandler } from "./types.ts";

/** Built per HTTP generation; never owns sockets, subscriptions, or agent processes. */
export function createRouteDispatcher(definitions: readonly RouteDefinition[]) {
  const router = createRouter<RouteHandler>();
  for (const route of definitions) {
    for (const method of typeof route.method === "string" ? [route.method] : route.method)
      addRoute(router, method, route.path, route.handler);
  }
  return async (context: Omit<RouteContext, "params">): Promise<boolean> => {
    const route = findRoute(router, context.method, context.path);
    if (!route) return false;
    await route.data({ ...context, params: route.params ?? {} });
    return true;
  };
}
