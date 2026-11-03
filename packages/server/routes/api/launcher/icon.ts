import { applicationIcon } from "../../../modules/launcher/index.ts";

import { sendIconFile, sendLetterIcon } from "../../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

export async function handleLauncherIcon({
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/launcher/icon" && method === "GET") {
    const id = url.searchParams.get("id") ?? "";
    const file = await applicationIcon(id).catch(() => null);
    if (file) sendIconFile(res, file);
    else sendLetterIcon(res, id);
    return true;
  }
  return false;
}
