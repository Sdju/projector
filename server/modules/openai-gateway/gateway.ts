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
const UPSTREAM_PATHS = new Set(["/chat/completions", "/completions", "/embeddings"]);
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

/** Every configured provider's model, so a client picks a provider by asking for its model. */
export async function listModels(): Promise<{ object: "list"; data: unknown[] }> {
  const { providers } = await loadStoredProviders(envFallbackFromProcess());
  const seen = new Set<string>();
  const data: unknown[] = [];
  for (const provider of providers) {
    const model = provider.model.trim();
    if (!provider.url.trim() || !model || seen.has(model)) continue;
    seen.add(model);
    data.push({ id: model, object: "model", created: 0, owned_by: provider.id });
  }
  return { object: "list", data };
}

async function providerForModel(model: unknown) {
  const fallback = envFallbackFromProcess();
  if (typeof model === "string" && model.trim()) {
    const { providers } = await loadStoredProviders(fallback);
    const match = providers.find((item) => item.model.trim() === model.trim() && item.url.trim());
    if (match) return resolveOpenAIProvider({ providerId: match.id, fallback });
  }
  return resolveOpenAIProvider({ fallback });
}

/** Forwards an OpenAI-style request to the provider that serves its model and streams the answer back. */
export async function forward(req: IncomingMessage, res: ServerResponse, endpoint: string) {
  const body = await readJson(req);
  const provider = await providerForModel(body.model);
  if (typeof body.model !== "string" || !body.model.trim()) body.model = provider.model;
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
    .on("error", () => res.destroy())
    .pipe(res);
}

export function isUpstreamPath(path: string): boolean {
  return UPSTREAM_PATHS.has(path);
}
