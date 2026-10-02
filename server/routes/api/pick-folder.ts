import { pickFolder } from "../../modules/folder-picker/index.ts";

import { json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handlePickFolder({ res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/pick-folder" && method === "POST") {
    const picked = await pickFolder();
    json(res, 200, { path: picked, cancelled: !picked });
    return true;
  }
  return false;
}
