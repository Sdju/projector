import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { HttpError } from "../http/index.ts";
import {
  envFallbackFromProcess,
  loadStoredProviders,
  normalizeOpenAiBaseUrl,
  resolveOpenAIProvider,
} from "../providers/index.ts";

export const GATEWAY_PREFIX = "/api/openai/v1";
const MAX_BODY = 32 * 1024 * 1024;
/** Enough for a provider error; a larger body is replaced by a generated error. */
const MAX_ERROR_BODY = 64 * 1024;
/** Hop-by-hop and length headers must not be copied from a decoded upstream body. */
const SKIP_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
]);

export function openAiError(
  res: ServerResponse,
  status: number,
  message: string,
  type = "invalid_request_error",
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ error: { message, type, param: null, code: null } }));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "Запрос слишком большой");
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, unknown>;
  } catch {
    // Reported below with the other malformed bodies.
  }
  throw new HttpError(400, "Тело запроса должно быть JSON-объектом");
}

const redact = (text: string, secret: string): string =>
  secret ? text.split(secret).join("[redacted]") : text;

/** A bounded read of an upstream error body; a broken or oversized body yields what arrived. */
async function readErrorBody(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_ERROR_BODY) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      size += value.length;
    }
    if (size >= MAX_ERROR_BODY) await reader.cancel().catch(() => {});
  } catch {
    // A body that breaks mid-read is still replaced by a generated error.
  }
  return Buffer.concat(chunks).subarray(0, MAX_ERROR_BODY).toString("utf8");
}

interface UpstreamError {
  message: string;
  type: string;
  param: string | null;
  code: string | null;
}

const optionalString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/** Only the OpenAI error fields may reach the client; everything else is dropped. */
function sanitizeErrorBody(text: string): UpstreamError | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const fields = error as Record<string, unknown>;
  if (typeof fields.message !== "string") return null;
  return {
    message: fields.message,
    type: optionalString(fields.type) ?? "invalid_request_error",
    param: optionalString(fields.param),
    code: optionalString(fields.code),
  };
}

/** Every registered model of every enabled provider, so a client picks a provider by its model. */
export async function listModels(): Promise<{ object: "list"; data: unknown[] }> {
  const { providers } = await loadStoredProviders(envFallbackFromProcess());
  const seen = new Set<string>();
  const data: unknown[] = [];
  for (const provider of providers) {
    if (!provider.enabled || !provider.url.trim()) continue;
    for (const { alias } of provider.models) {
      if (seen.has(alias)) continue;
      seen.add(alias);
      data.push({ id: alias, object: "model", created: 0, owned_by: provider.id });
    }
  }
  return { object: "list", data };
}

async function providerForModel(model: unknown) {
  const fallback = envFallbackFromProcess();
  if (typeof model === "string" && model.trim()) {
    const name = model.trim();
    const { providers } = await loadStoredProviders(fallback);
    const match = providers.find(
      (item) => item.enabled && item.url.trim() && item.models.some((row) => row.alias === name),
    );
    if (match) return resolveOpenAIProvider({ providerId: match.id, model: name, fallback });
  }
  return resolveOpenAIProvider({ fallback });
}

/** Forwards an OpenAI-style request to the provider that serves its model and streams the answer back. */
export async function forward(req: IncomingMessage, res: ServerResponse, endpoint: string) {
  const body = await readJson(req);
  const provider = await providerForModel(body.model);
  // The client asks by registered name; upstream knows the model by its own id.
  body.model = provider.model;
  const base = normalizeOpenAiBaseUrl(provider.url);

  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) abort.abort();
  });
  const upstream = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: String(req.headers.accept ?? "application/json"),
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: abort.signal,
  });

  // Upstream failures are internal: the client gets a generic OpenAI error, the details stay in the log.
  if (upstream.status >= 500) {
    const detail = await readErrorBody(upstream.body);
    console.error(
      `OpenAI-шлюз: провайдер ответил ${upstream.status}: ${redact(detail.slice(0, 2000), provider.apiKey)}`,
    );
    res.setHeader("Cache-Control", "no-store");
    openAiError(res, 502, "Провайдер вернул ошибку", "api_error");
    return;
  }

  // A 4xx keeps its status for the client, but only the OpenAI error fields are forwarded.
  if (upstream.status >= 400) {
    const sanitized = sanitizeErrorBody(await readErrorBody(upstream.body));
    res.setHeader("Cache-Control", "no-store");
    if (sanitized) {
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: sanitized }));
    } else {
      openAiError(res, upstream.status, "Провайдер отклонил запрос");
    }
    return;
  }

  res.statusCode = upstream.status;
  upstream.headers.forEach((value, name) => {
    if (!SKIP_HEADERS.has(name.toLowerCase())) res.setHeader(name, value);
  });
  res.setHeader("Cache-Control", "no-store");
  if (!upstream.body) {
    res.end();
    return;
  }
  Readable.fromWeb(upstream.body as never)
    .on("error", (error: Error) => {
      console.error(
        `OpenAI-шлюз: поток провайдера прерван: ${redact(error?.message ?? String(error), provider.apiKey)}`,
      );
      res.destroy();
    })
    .pipe(res);
}
