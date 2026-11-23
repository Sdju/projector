import { accessAllowed } from "../../modules/access/index.ts";
import { HttpError } from "../../modules/http/index.ts";
import { listenerState, listenerTranscribe } from "../../modules/agent-roles/index.ts";
import { json, readBody } from "../../modules/transport/index.ts";
import type { RouteDefinition } from "../../modules/transport/index.ts";

/** A decoded recording: five minutes of 16 kHz mono WAV is 9.6 MB, base64 adds a third. */
const AUDIO_BASE64_LIMIT = 22 * 1024 * 1024;
const AUDIO_BYTES_LIMIT = 16 * 1024 * 1024;
const BODY_LIMIT = AUDIO_BASE64_LIMIT + 64 * 1024;

const pageOnly = (req: Parameters<typeof accessAllowed>[0], change = false) => {
  if (!accessAllowed(req, change))
    throw new HttpError(403, "Listener доступен только со страницы Projector");
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** The recording from the body: base64 string or `{ base64, mime }`; only audio MIME types pass. */
function audioFrom(body: Record<string, unknown>): { base64: string; mime: string } {
  const source = record(body.audio) ?? {};
  const raw =
    typeof body.audio === "string" ? body.audio : text(source.base64) || text(source.data);
  const base64 = raw.replace(/^data:[^;]+;base64,/, "").trim();
  if (!base64) throw new HttpError(400, "Нужен звук: audio.base64");
  if (base64.length > AUDIO_BASE64_LIMIT)
    throw new HttpError(413, "Запись больше 16 МБ или длиннее пяти минут");
  const bytes = Buffer.from(base64, "base64");
  if (!bytes.length) throw new HttpError(400, "Звук не разбирается как base64");
  if (bytes.length > AUDIO_BYTES_LIMIT) throw new HttpError(413, "Запись больше 16 МБ");
  const mime = (text(source.mime) || text(body.mime) || "audio/wav").toLowerCase();
  if (!mime.startsWith("audio/"))
    throw new HttpError(400, "Listener принимает только audio/*: wav, webm, mp3, m4a или ogg");
  return { base64, mime };
}

/** The built-in Listener role: its recognition model, its context and one transcription call. */
export const routes: RouteDefinition[] = [
  {
    method: "GET",
    path: "/api/agent/listener",
    handler: async ({ req, res }) => {
      pageOnly(req);
      res.setHeader("Cache-Control", "no-store");
      json(res, 200, await listenerState());
    },
  },
  {
    method: "POST",
    path: "/api/agent/listener/transcribe",
    handler: async ({ req, res }) => {
      pageOnly(req, true);
      res.setHeader("Cache-Control", "no-store");
      const body = await readBody(req, BODY_LIMIT);
      const started = Date.now();
      const result = await listenerTranscribe({
        audio: audioFrom(body),
        ...(text(body.language) ? { language: text(body.language) } : {}),
        ...(text(body.hints) ? { hints: text(body.hints) } : {}),
      });
      json(res, 200, { ...result, ms: Date.now() - started });
    },
  },
];
