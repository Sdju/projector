import { createReadStream } from "node:fs";
import type { ServerResponse } from "node:http";
import type { MediaCapability } from "@ai-projector/core/modules/media/index.ts";
import { isMediaCapability, mediaJobView } from "@ai-projector/core/modules/media/index.ts";
import { isLocalRequest } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import {
  cancelMediaJob,
  generateMedia,
  listMediaModels,
  mediaFile,
  mediaJob,
  mediaProviders,
  temporaryMediaKey,
} from "../../modules/media/index.ts";
import { json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

const decode = (value: string | undefined): string => {
  try {
    return decodeURIComponent(value ?? "").trim();
  } catch {
    throw new HttpError(400, "Некорректный идентификатор");
  }
};

const MEDIA_BODY_LIMIT = 100 * 1024 * 1024;

const noStore = (res: ServerResponse): void => {
  res.setHeader("Cache-Control", "no-store");
};

export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/media",
    handler: async ({ res }) => {
      noStore(res);
      json(res, 200, await mediaProviders());
    },
  },
  {
    method: "GET",
    path: "/api/media/models",
    handler: async ({ res, url }) => {
      noStore(res);
      const raw = url.searchParams.get("capability")?.trim() ?? "";
      if (raw && !isMediaCapability(raw)) throw new HttpError(400, "Неизвестная медиа-возможность");
      json(res, 200, {
        models: await listMediaModels(raw ? (raw as MediaCapability) : undefined),
      });
    },
  },
  {
    method: "POST",
    path: "/api/media/generate",
    handler: async ({ req, res }) => {
      noStore(res);
      const job = await generateMedia(await readBody(req, MEDIA_BODY_LIMIT));
      if (job.status !== "succeeded") res.setHeader("Location", `/api/media/jobs/${job.id}`);
      json(res, job.status === "succeeded" ? 200 : 202, mediaJobView(job));
    },
  },
  {
    method: "GET",
    path: "/api/media/jobs/:id",
    handler: async ({ res, params }) => {
      noStore(res);
      json(res, 200, mediaJobView(await mediaJob(decode(params.id))));
    },
  },
  {
    method: "POST",
    path: "/api/media/jobs/:id/cancel",
    handler: async ({ res, params }) => {
      noStore(res);
      json(res, 200, mediaJobView(await cancelMediaJob(decode(params.id))));
    },
  },
  {
    method: "GET",
    path: "/api/media/files/:id",
    handler: async ({ res, params }) => {
      const file = await mediaFile(decode(params.id));
      noStore(res);
      res.statusCode = 200;
      res.setHeader("Content-Type", file.meta.mime);
      res.setHeader("Content-Length", String(file.meta.size));
      res.setHeader("Content-Disposition", `inline; filename="${file.meta.id}"`);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      const stream = createReadStream(file.path);
      stream.on("error", () => {
        if (!res.headersSent) json(res, 404, { error: "Медиа-файл не найден" });
        else res.destroy();
      });
      stream.pipe(res);
    },
  },
  {
    method: "POST",
    path: "/api/media/keys/temporary",
    handler: async ({ req, res }) => {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Временный ключ выдаётся только с локальной машины");
      noStore(res);
      json(res, 200, await temporaryMediaKey(await readBody(req, MEDIA_BODY_LIMIT)));
    },
  },
];
