import type { RouteContext } from "../modules/transport/index.ts";
import { json } from "../modules/transport/index.ts";
import { terminalRequestAllowed } from "../modules/terminal/index.ts";

export function localOrigin({ req, res, url, path }: RouteContext): boolean {
  const origin = req.headers.origin;
  if (origin && origin !== url.origin) {
    json(res, 403, { error: "Запрос разрешён только со страницы Projector" });
    return false;
  }
  if (
    /^\/api\/projects\/[^/]+\/terminals(?:\/|$)/.test(path) &&
    !terminalRequestAllowed(req, false)
  ) {
    json(res, 403, { error: "Терминал доступен только со страницы Projector" });
    return false;
  }
  return true;
}
