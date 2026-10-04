import type { RouteContext } from "../modules/transport/index.ts";
import { authorizeHttp } from "../modules/access/index.ts";

export function localOrigin({ req, res }: RouteContext): boolean {
  return authorizeHttp(req, res);
}
