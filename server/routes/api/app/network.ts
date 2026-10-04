import {
  appUrl,
  readNetworkMode,
  writeNetworkMode,
} from "../../../../core/modules/app-paths/index.ts";
import { isNetworkMode } from "../../../../core/modules/network-mode/index.ts";
import { HttpError } from "../../../modules/http/index.ts";
import { restartProjector } from "../../../modules/restart/index.ts";
import {
  clearLanPassword,
  hasLanPassword,
  isLocalRequest,
  lanUrl,
  lanUrls,
  setLanPassword,
} from "../../../modules/access/index.ts";
import { json, readBody } from "../../../modules/transport/index.ts";
import type { RouteContext } from "../../../modules/transport/index.ts";

/**
 * Состояние доступа по сети и его смена. Смена режима перезапускает сервер,
 * так как host привязки Vite меняется; пароль применяется сразу, без рестарта.
 */
export async function handleAppNetwork({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path !== "/api/app/network") return false;
  if (method === "GET") {
    json(res, 200, {
      mode: readNetworkMode(),
      passwordRequired: hasLanPassword(),
      lanUrl: lanUrl(),
      lanUrls: lanUrls(),
    });
    return true;
  }
  if (method === "POST") {
    if (!isLocalRequest(req))
      throw new HttpError(403, "Смена режима доступна только с локальной машины");
    const body = await readBody(req);
    if (!isNetworkMode(body.mode)) throw new HttpError(400, "Режим: local или lan");
    const restarted = readNetworkMode() !== body.mode;
    if (restarted) writeNetworkMode(body.mode);
    if (body.password !== undefined) {
      if (body.password === null || body.password === "") clearLanPassword();
      else if (typeof body.password !== "string")
        throw new HttpError(400, "Пароль должен быть строкой");
      else setLanPassword(body.password);
    }
    if (restarted) {
      await restartProjector(appUrl());
      json(res, 200, { ok: true, restarted: true });
      setTimeout(() => process.exit(0), 100).unref();
    } else {
      json(res, 200, { ok: true, restarted: false });
    }
    return true;
  }
  return false;
}
