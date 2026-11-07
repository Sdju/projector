import { pipeline } from "node:stream/promises";
import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { json, type RouteDefinition } from "../../../../modules/transport/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import { openProjectSiteFile } from "../../../../modules/workspace/index.ts";

const sitePath = "/api/projects/:id/site/**";

/**
 * Файлы проекта по обычным путям, чтобы относительные ссылки HTML-документа работали
 * без переписывания. Документ исполняется в песочнице без origin Projector: его скрипты
 * не получают доступ к API (терминалы, запись файлов).
 */
export const routes: RouteDefinition[] = [
  {
    method: ["GET", "HEAD"],
    path: sitePath,
    handler: async ({ req, res, url, method, path, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Просмотр доступен только со страницы Projector");
      const project = await findProject(decodeURIComponent(params.id));
      if (!project) {
        json(res, 404, { error: "Проект не найден" });
        return;
      }
      let relative: string;
      try {
        relative = (params["0"] ?? "").split("/").map(decodeURIComponent).join("/");
      } catch {
        throw new HttpError(400, "Некорректный путь");
      }
      const file = await openProjectSiteFile(project.path, relative);
      if ("redirect" in file) {
        res.writeHead(307, { Location: `${path}/${url.search}` }).end();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Cross-origin for the opaque sandbox origin: fonts, modules and fetch() need CORS.
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader(
        "Content-Security-Policy",
        "sandbox allow-scripts allow-forms allow-popups allow-modals",
      );
      res.setHeader("Content-Type", file.type);
      res.setHeader("Content-Length", file.size);
      if (method === "HEAD") {
        file.stream.destroy();
        res.end();
        return;
      }
      await pipeline(file.stream, res).catch(() => res.destroy());
    },
  },
  {
    method: "",
    path: sitePath,
    handler: () => {
      throw new HttpError(405, "Допустим только GET");
    },
  },
];
