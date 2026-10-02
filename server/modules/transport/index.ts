export { json, readBody, asString, escapeHtml } from "./implementation.ts";

import type { IncomingMessage, ServerResponse } from "node:http";
export interface RouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  path: string;
}
