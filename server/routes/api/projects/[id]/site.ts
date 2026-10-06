import { pipeline } from "node:stream/promises";
import { findProject } from "../../../../modules/projects/index.ts";
import { HttpError } from "../../../../modules/http/index.ts";
import { json } from "../../../../modules/transport/index.ts";
import { accessAllowed } from "../../../../modules/access/index.ts";
import { openProjectSiteFile } from "../../../../modules/workspace/index.ts";
import type { RouteContext } from "../../../../modules/transport/index.ts";

/**
 * Файлы проекта по обычным путям, чтобы относительные ссылки HTML-документа работали
 * без переписывания. Документ исполняется в песочнице без origin Projector: его скрипты
 * не получают доступ к API (терминалы, запись файлов).
 */
export async function handleProjectSite({
  req,
  res,
  url,
  method,
  path,
}: RouteContext): Promise<boolean> {
  const match = path.match(/^\/api\/projects\/([^/]+)\/site(?:\/(.*))?$/);
  if (!match) return false;
  if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Допустим только GET");
  if (!accessAllowed(req, false))
    throw new HttpError(403, "Просмотр доступен только со страницы Projector");
  const project = await findProject(decodeURIComponent(match[1]!));
  if (!project) {
    json(res, 404, { error: "Проект не найден" });
    return true;
  }
  let relative: string;
  try {
    relative = (match[2] ?? "").split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new HttpError(400, "Некорректный путь");
  }
  const file = await openProjectSiteFile(project.path, relative);
  if ("redirect" in file) {
    res.writeHead(307, { Location: `${path}/${url.search}` }).end();
    return true;
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
    return true;
  }
  await pipeline(file.stream, res).catch(() => res.destroy());
  return true;
}
