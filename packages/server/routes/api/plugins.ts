import { pipeline } from "node:stream/promises";
import {
  PluginStorageLimitError,
  PluginStoragePathError,
  deletePluginStorageValue,
  discoverPlugins,
  installPlugin,
  openPluginAsset,
  openPluginReadmeFile,
  pluginPackageExists,
  readPluginReadme,
  readPluginStorage,
  rebuildPlugin,
  removePlugin,
  setPluginEnabled,
  trustPlugin,
  writePluginStorageValue,
} from "../../modules/plugins/index.ts";
import {
  pluginPackageName,
  pluginStorageMaxBytes,
} from "@ai-projector/core/modules/plugins/index.ts";
import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { asString, json, readBody, type RouteDefinition } from "../../modules/transport/index.ts";

const assetPath = "/api/plugins/assets/:key/:hash/**";
const storagePath = "/api/plugins/:key/storage";
const readmePath = "/api/plugins/:key/readme";
const readmeFilePath = "/api/plugins/:key/readme/**";
/** The envelope around one value is small; the quota itself is checked after serialization. */
const storageBodyLimit = pluginStorageMaxBytes + 64_000;

/** The key in the URL is base64url of the package name; data never accepts a raw path. */
async function storagePackage(key: string | undefined): Promise<string> {
  const name = pluginPackageName(key ?? "");
  if (!name || !(await pluginPackageExists(name))) throw new HttpError(404, "Плагин не найден");
  return name;
}

async function catalogPlugin(key: string | undefined) {
  const name = pluginPackageName(key ?? "");
  if (!name) return undefined;
  const catalog = await discoverPlugins();
  return catalog.plugins.find((item) => item.id === name);
}

function storageFailure(error: unknown): never {
  if (error instanceof PluginStorageLimitError) throw new HttpError(413, error.message);
  if (error instanceof PluginStoragePathError) throw new HttpError(409, error.message);
  throw error;
}

export const routes: RouteDefinition[] = [
  {
    method: ["GET", "HEAD"],
    path: readmePath,
    handler: async ({ req, res, method, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const markdown = await readPluginReadme(await catalogPlugin(params.key));
      if (markdown === null) {
        json(res, 404, { error: "README недоступен" });
        return;
      }
      const body = Buffer.from(markdown, "utf8");
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      res.setHeader("Content-Length", body.byteLength);
      if (method === "HEAD") {
        res.end();
        return;
      }
      res.end(body);
    },
  },
  {
    method: ["GET", "HEAD"],
    path: readmeFilePath,
    handler: async ({ req, res, method, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      let relative: string;
      try {
        relative = (params["0"] ?? "").split("/").map(decodeURIComponent).join("/");
      } catch {
        throw new HttpError(400, "Некорректный путь README");
      }
      const asset = await openPluginReadmeFile(await catalogPlugin(params.key), relative);
      if (!asset) {
        json(res, 404, { error: "Файл README недоступен" });
        return;
      }
      res.setHeader("Content-Type", asset.type);
      res.setHeader("Content-Length", asset.size);
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (method === "HEAD") {
        asset.stream.destroy();
        res.end();
        return;
      }
      await pipeline(asset.stream, res).catch(() => res.destroy());
    },
  },
  {
    method: "",
    path: readmePath,
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустим только GET" });
    },
  },
  {
    method: "",
    path: readmeFilePath,
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустим только GET" });
    },
  },
  {
    method: ["GET", "HEAD"],
    path: assetPath,
    handler: async ({ req, res, method, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const name = pluginPackageName(params.key ?? "");
      let relative: string;
      try {
        relative = (params["0"] ?? "").split("/").map(decodeURIComponent).join("/");
      } catch {
        throw new HttpError(400, "Некорректный путь ассета");
      }
      const catalog = await discoverPlugins();
      const plugin = name ? catalog.plugins.find((item) => item.id === name) : undefined;
      const asset = await openPluginAsset(plugin, params.hash ?? "", relative);
      if (!asset) {
        json(res, 404, { error: "Ассет плагина недоступен" });
        return;
      }
      res.setHeader("Content-Type", asset.type);
      res.setHeader("Content-Length", asset.size);
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      if (method === "HEAD") {
        asset.stream.destroy();
        res.end();
        return;
      }
      await pipeline(asset.stream, res).catch(() => res.destroy());
    },
  },
  {
    method: "",
    path: assetPath,
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Допустим только GET" });
    },
  },
  {
    method: "GET",
    path: storagePath,
    handler: async ({ req, res, params }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const name = await storagePackage(params.key);
      const data = await readPluginStorage(name).catch(storageFailure);
      json(res, 200, { data });
    },
  },
  {
    method: "PUT",
    path: storagePath,
    handler: async ({ req, res, params }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const name = await storagePackage(params.key);
      const body = await readBody(req, storageBodyLimit);
      if (!("value" in body)) throw new HttpError(400, "Укажите ключ и значение");
      await writePluginStorageValue(name, body.key, body.value).catch(storageFailure);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "DELETE",
    path: storagePath,
    handler: async ({ req, res, params, url }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const name = await storagePackage(params.key);
      const key = url.searchParams.get("key");
      if (!key) throw new HttpError(400, "Укажите ключ");
      await deletePluginStorageValue(name, key).catch(storageFailure);
      json(res, 200, { ok: true });
    },
  },
  {
    method: "",
    path: storagePath,
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
  {
    method: "GET",
    path: "/api/plugins",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await discoverPlugins());
    },
  },
  {
    method: "POST",
    path: "/api/plugins",
    handler: async ({ req, res }) => {
      if (!accessAllowed(req, true))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req);
      const action = asString(body.action);
      if (action === "refresh") json(res, 200, await discoverPlugins());
      else if (action === "enable") json(res, 200, await setPluginEnabled(asString(body.id), true));
      else if (action === "disable")
        json(res, 200, await setPluginEnabled(asString(body.id), false));
      else if (action === "install") json(res, 200, await installPlugin(body.path));
      else if (action === "rebuild")
        json(res, 200, await rebuildPlugin({ id: asString(body.id), path: asString(body.path) }));
      else if (action === "trust") json(res, 200, await trustPlugin(asString(body.id)));
      else if (action === "remove") json(res, 200, await removePlugin(asString(body.id)));
      else throw new HttpError(400, "Неизвестное действие с плагином");
    },
  },
  {
    method: "",
    path: "/api/plugins",
    handler: ({ req, res }) => {
      if (!accessAllowed(req, false))
        throw new HttpError(403, "Плагины доступны только со страницы Projector");
      res.setHeader("Cache-Control", "no-store");
      json(res, 405, { error: "Метод не поддерживается" });
    },
  },
];
