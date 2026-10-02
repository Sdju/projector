import { listSnapshots } from "../../modules/processes/index.ts";

import { json } from "../../modules/transport/index.ts";

import type { RouteContext } from "../../modules/transport/index.ts";

export async function handleStatus({ res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/status" && method === "GET") {
    json(res, 200, { processes: listSnapshots() });
    return true;
  }
  return false;
}
