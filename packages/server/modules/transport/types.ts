import type { IncomingMessage, ServerResponse } from "node:http";
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
  params: Record<string, string>;
}

/** A matched endpoint owns its response, including long-lived streams. */
export type RouteHandler = (context: RouteContext) => void | Promise<void>;

export interface RouteDefinition {
  method: string | readonly string[];
  path: string;
  handler: RouteHandler;
}
