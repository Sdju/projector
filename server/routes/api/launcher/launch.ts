import { launchItem } from "../../../modules/launcher/index.ts";

import { json, readBody, asString } from "../../../modules/transport/index.ts";

import type { LaunchActionId } from "../../../../core/modules/launcher/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherLaunch({
  req,
  res,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/launch" && method === "POST") {
    const body = await readBody(req);
    const action = asString(body.action);
    if (action && !["launch", "open", "run", "stop", "browser", "window"].includes(action))
      throw new Error("Неизвестное действие");
    json(
      res,
      200,
      await launchItem(
        asString(body.id),
        (action || undefined) as LaunchActionId | undefined,
        body.inline === true,
        asString(body.arg) || undefined,
      ),
    );
    return true;
  }
  return false;
}
