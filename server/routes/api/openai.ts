import { HttpError } from "../../modules/http/index.ts";
import {
  GATEWAY_PREFIX,
  forward,
  gatewayEnabled,
  gatewayHasKey,
  gatewayOrigins,
  isUpstreamPath,
  listModels,
  openAiError,
  setGatewayEnabled,
  setGatewayKey,
  setGatewayOrigins,
} from "../../modules/openai-gateway/index.ts";
import { isLocalRequest } from "../../modules/access/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteContext } from "../../modules/transport/index.ts";

const state = () => ({
  enabled: gatewayEnabled(),
  hasKey: gatewayHasKey(),
  origins: gatewayOrigins(),
  baseUrl: GATEWAY_PREFIX,
});

/**
 * OpenAI-совместимый API под `/api/openai/v1` для других приложений на машине. Запросы идут
 * к провайдерам Projector; страницы других сайтов допускаются только из белого списка origins. Если задан ключ, он обязателен (Bearer), иначе
 * действуют общие правила доступа (в LAN с паролем — пароль). Выключен, пока не включат
 * через `/api/openai`.
 */
export async function handleOpenAi({ req, res, method, path }: RouteContext): Promise<boolean> {
  if (path === "/api/openai") {
    if (method === "GET") {
      json(res, 200, state());
      return true;
    }
    if (method === "PUT") {
      if (!isLocalRequest(req))
        throw new HttpError(403, "Шлюз настраивается только с локальной машины");
      const body = await readBody(req);
      if (body.enabled !== undefined && typeof body.enabled !== "boolean")
        throw new HttpError(400, "enabled: boolean");
      if (body.apiKey !== undefined && body.apiKey !== null && typeof body.apiKey !== "string")
        throw new HttpError(400, "apiKey: string или null");
      if (body.origins !== undefined && !Array.isArray(body.origins))
        throw new HttpError(400, "origins: массив строк");
      if (body.enabled === undefined && body.apiKey === undefined && body.origins === undefined)
        throw new HttpError(400, "Нужен enabled, apiKey или origins");
      if (typeof body.enabled === "boolean") setGatewayEnabled(body.enabled);
      if (body.apiKey !== undefined) setGatewayKey((body.apiKey ?? "").trim());
      if (body.origins !== undefined) setGatewayOrigins(body.origins);
      json(res, 200, state());
      return true;
    }
    return false;
  }
  if (path !== GATEWAY_PREFIX && !path.startsWith(`${GATEWAY_PREFIX}/`)) return false;

  try {
    if (!gatewayEnabled()) {
      openAiError(res, 404, "OpenAI-совместимый API Projector выключен", "not_found_error");
      return true;
    }
    const endpoint = path.slice(GATEWAY_PREFIX.length);
    if (endpoint === "/models" && method === "GET") {
      json(res, 200, await listModels());
    } else if (isUpstreamPath(endpoint) && method === "POST") {
      await forward(req, res, endpoint);
    } else {
      openAiError(res, 404, `Неизвестный метод: ${method} ${endpoint}`, "not_found_error");
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 502;
    if (res.headersSent) res.destroy();
    else
      openAiError(
        res,
        status,
        error instanceof Error ? error.message : "Ошибка шлюза",
        status === 502 ? "api_error" : "invalid_request_error",
      );
  }
  return true;
}
