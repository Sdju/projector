import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { writeFileAtomic, withFileLock } from "../../../modules/atomic-files/index.ts";
import { accessAllowed } from "../../../modules/access/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { json, readBody, type RouteDefinition } from "../../../modules/transport/index.ts";

const path = () => join(dataDir(), "hidden-actions.json");
const orderPath = () => join(dataDir(), "action-order.json");
async function readOrder(): Promise<Record<string, string[]>> {
  try {
    const value: unknown = JSON.parse(await readFile(orderPath(), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, ids]) => Array.isArray(ids) && ids.every((id: unknown) => typeof id === "string"),
      ),
    );
  } catch {
    return {};
  }
}
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
    path: "/api/ide/action-order",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false)) throw new HttpError(403, "Доступ запрещён");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await readOrder());
    },
  },
  {
    method: "PUT",
    path: "/api/ide/action-order",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true)) throw new HttpError(403, "Доступ запрещён");
      const body = await readBody(req);
      if (
        typeof body.scope !== "string" ||
        !body.scope ||
        body.scope.length > 256 ||
        !Array.isArray(body.ids) ||
        body.ids.length > 500 ||
        body.ids.some((id: unknown) => typeof id !== "string" || !id || id.length > 256) ||
        new Set(body.ids).size !== body.ids.length
      )
        throw new HttpError(400, "Укажите scope и ids");
      const order = await withFileLock(orderPath(), async () => {
        const result = await readOrder();
        result[body.scope as string] = body.ids as string[];
        await writeFileAtomic(orderPath(), JSON.stringify(result, null, 2) + "\n");
        return result;
      });
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, order);
    },
  },
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
