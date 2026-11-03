import { expandPath } from "../../modules/projects/index.ts";

import { resolveProjectIcon } from "../../modules/projects/index.ts";

import { basename } from "node:path";

import { asString } from "../../modules/transport/index.ts";

import { sendIconFile, sendLetterIcon } from "../../modules/project-presentation/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

export async function handlePreviewIcon({
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  if (path === "/api/preview-icon" && method === "GET") {
    const projectPath = expandPath(asString(url.searchParams.get("path")));
    if (!projectPath) throw new Error("Укажите путь");
    const file = await resolveProjectIcon(projectPath, null);
    if (file) sendIconFile(res, file);
    else sendLetterIcon(res, basename(projectPath));
    return true;
  }
  return false;
}
