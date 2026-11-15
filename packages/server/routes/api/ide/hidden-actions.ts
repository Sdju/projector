import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic, withFileLock } from "../../../modules/atomic-files/index.ts";
import { accessAllowed } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { json, readBody, type RouteDefinition } from "../../../modules/transport/index.ts";

const path = () => join(dataDir(), "hidden-actions.json");
async function read(): Promise<string[]> {
  try {
    const value: unknown = JSON.parse(await readFile(path(), "utf8"));
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/ide/hidden-actions",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false)) throw new HttpError(403, "Доступ запрещён");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { hidden: await read() });
    },
  },
  {
    method: "PUT",
    path: "/api/ide/hidden-actions",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true)) throw new HttpError(403, "Доступ запрещён");
      const body = await readBody(req);
      if (
        typeof body.id !== "string" ||
        !body.id ||
        body.id.length > 256 ||
        typeof body.hidden !== "boolean"
      )
        throw new HttpError(400, "Укажите id и hidden");
      const hidden = await withFileLock(path(), async () => {
        const items = new Set(await read());
        if (body.hidden) items.add(body.id as string);
        else items.delete(body.id as string);
        const result = [...items];
        await writeFileAtomic(path(), JSON.stringify(result, null, 2) + "\n");
        return result;
      });
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, { hidden });
    },
  },
];
