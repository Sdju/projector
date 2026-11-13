import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../http/index.ts";

export function json(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function readBody(
  req: IncomingMessage,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const bytes = chunk as Buffer;
    size += bytes.length;
    if (size > maxBytes) throw new HttpError(413, "Тело запроса слишком большое");
    chunks.push(bytes);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
