import type { RouteContext } from "../modules/transport/index.ts";
import { json } from "../modules/transport/index.ts";
import { accessAllowed } from "../modules/access/index.ts";

export function localOrigin({ req, res }: RouteContext): boolean {
  if (!accessAllowed(req, false)) {
    json(res, 403, { error: "Доступ разрешён только с локальной машины или с паролем Projector" });
    return false;
  }
  return true;
}
