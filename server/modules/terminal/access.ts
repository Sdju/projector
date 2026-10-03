import type { IncomingMessage } from "node:http";

export function terminalRequestAllowed(req: IncomingMessage, requireOrigin = true): boolean {
  try {
    const url = new URL(`http://${req.headers.host}`);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return false;
    const origin = req.headers.origin;
    // Browser WebSocket handshakes must have an exact same-origin header.
    if (!origin) return !requireOrigin;
    return (
      origin ===
      `${"encrypted" in req.socket && req.socket.encrypted ? "https:" : "http:"}//${url.host}`
    );
  } catch {
    return false;
  }
}
