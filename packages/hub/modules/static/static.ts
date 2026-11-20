import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic as sendStatic } from "@ai-projector/core/modules/node-http/index.ts";

function deviceHtml(html: string, pathname: string): string {
  const device = /^\/devices\/([a-z0-9][a-z0-9-]{0,62})(?:\/|$)/.exec(pathname)?.[1];
  return device
    ? html.replace(
        'src="/api/appearance/bootstrap.js"',
        `src="/api/devices/${device}/appearance/bootstrap.js"`,
      )
    : html;
}

export function serveStatic(
  root: string,
  req: IncomingMessage,
  res: ServerResponse,
  shell?: string,
) {
  return sendStatic(root, req, res, { shell, transformHtml: deviceHtml });
}
