import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { readFile, rename, unlink, writeFile, mkdir } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dataDir } from "@ai-projector/core/modules/app-paths/index.ts";
import { HttpError } from "../http/index.ts";
import type { MediaArtifactSource } from "./types.ts";
import type { MediaArtifact } from "@ai-projector/core/modules/media/index.ts";

const LIMITS: Record<MediaArtifact["kind"], number> = {
  image: 32 * 1024 * 1024,
  audio: 64 * 1024 * 1024,
  video: 512 * 1024 * 1024,
  text: 2 * 1024 * 1024,
};

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/mp4": "m4a",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "text/plain": "txt",
};

const SAFE_MIMES: Record<MediaArtifact["kind"], ReadonlySet<string>> = {
  image: new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  audio: new Set([
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/opus",
    "audio/mp4",
  ]),
  video: new Set(["video/mp4", "video/webm", "video/quicktime"]),
  text: new Set(["text/plain"]),
};

export interface StoredArtifact {
  id: string;
  providerId: string;
  kind: MediaArtifact["kind"];
  mime: string;
  size: number;
  createdAt: number;
}

interface Store {
  items: Map<string, StoredArtifact>;
  loading: Promise<void> | null;
  writing: Promise<void>;
}

const globalState = globalThis as typeof globalThis & { projectorMediaArtifacts?: Store };
const state = (): Store =>
  (globalState.projectorMediaArtifacts ??= {
    items: new Map(),
    loading: null,
    writing: Promise.resolve(),
  });

const mediaDir = () => join(dataDir(), "media");
const filesDir = () => join(mediaDir(), "files");
const indexPath = () => join(mediaDir(), "artifacts.json");

async function ensureLoaded(): Promise<void> {
  const store = state();
  if (store.loading) return store.loading;
  store.loading = (async () => {
    try {
      const raw = JSON.parse(await readFile(indexPath(), "utf8")) as { artifacts?: unknown };
      for (const item of Array.isArray(raw.artifacts) ? raw.artifacts : []) {
        if (!isStoredArtifact(item)) continue;
        store.items.set(item.id, item);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("Каталог медиа-артефактов не прочитан:", (error as Error).message);
    }
  })();
  return store.loading;
}

const normalizedMime = (value: unknown): string =>
  typeof value === "string" ? (value.split(";")[0]?.trim().toLowerCase() ?? "") : "";

const safeMime = (kind: MediaArtifact["kind"], value: unknown): string | null => {
  const mime = normalizedMime(value);
  return SAFE_MIMES[kind].has(mime) ? mime : null;
};

function isStoredArtifact(value: unknown): value is StoredArtifact {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const kind = item.kind;
  return (
    typeof item.id === "string" &&
    /^[a-f0-9]{24}\.[a-z0-9]{1,8}$/.test(item.id) &&
    typeof item.providerId === "string" &&
    (kind === "image" || kind === "audio" || kind === "video" || kind === "text") &&
    safeMime(kind, item.mime) !== null &&
    typeof item.size === "number" &&
    Number.isFinite(item.size) &&
    typeof item.createdAt === "number"
  );
}

function persist(): Promise<void> {
  const store = state();
  const snapshot = [...store.items.values()].sort(
    (left, right) => left.createdAt - right.createdAt,
  );
  const writing = store.writing.then(async () => {
    await mkdir(mediaDir(), { recursive: true });
    const temporary = `${indexPath()}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ artifacts: snapshot }, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, indexPath());
  });
  store.writing = writing.catch((error) => {
    console.error("Каталог медиа-артефактов не сохранён:", error.message);
  });
  return writing;
}

function extensionFor(mime: string, kind: MediaArtifact["kind"]): string {
  const known = EXTENSIONS[normalizedMime(mime)];
  if (known) return known;
  return kind === "image" ? "png" : kind === "audio" ? "mp3" : kind === "video" ? "mp4" : "txt";
}

function artifactId(extension: string): string {
  return `${randomUUID().replaceAll("-", "").slice(0, 24)}.${extension}`;
}

function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  const family = isIP(host);
  if (family === 4) {
    const parts = host.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127) ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      parts[0]! >= 224
    );
  }
  if (family === 6) {
    if (host === "::" || host === "::1") return true;
    if (host.startsWith("::ffff:")) return privateHost(host.slice(7));
    return /^(?:fc|fd|fe[89ab])/i.test(host);
  }
  return false;
}

async function artifactUrl(url: string, allowedHosts?: readonly string[]): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HttpError(502, "Провайдер вернул некорректную ссылку на файл");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:")
    throw new HttpError(502, "Файл провайдера должен быть по HTTPS");
  if (parsed.username || parsed.password || privateHost(hostname))
    throw new HttpError(502, "Ссылка провайдера указывает на недопустимый адрес");
  if (
    allowedHosts?.length &&
    !allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`))
  )
    throw new HttpError(502, "Провайдер вернул файл с неразрешённого хоста");
  if (!allowedHosts?.length && !isIP(hostname.replace(/^\[|\]$/g, ""))) {
    let addresses;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new HttpError(502, "Не удалось проверить адрес файла провайдера");
    }
    if (addresses.some((entry) => privateHost(entry.address)))
      throw new HttpError(502, "Ссылка провайдера указывает на недопустимый адрес");
  }
  return parsed;
}

async function download(
  url: string,
  kind: MediaArtifact["kind"],
  expectedMime: string,
  target: string,
  allowedHosts?: readonly string[],
): Promise<{ mime: string; size: number }> {
  const parsed = await artifactUrl(url, allowedHosts);
  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "error",
      signal: AbortSignal.timeout(kind === "video" ? 300000 : 60000),
    });
  } catch {
    throw new HttpError(502, "Не удалось скачать результат провайдера");
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new HttpError(502, `Результат провайдера недоступен: HTTP ${response.status}`);
  }
  const upstreamMime = normalizedMime(response.headers.get("content-type"));
  const mime =
    !upstreamMime || upstreamMime === "application/octet-stream"
      ? safeMime(kind, expectedMime)
      : safeMime(kind, upstreamMime);
  if (!mime) {
    await response.body.cancel();
    throw new HttpError(502, "Провайдер вернул недопустимый тип медиа-файла");
  }
  const limit = LIMITS[kind];
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limit) {
    await response.body.cancel();
    throw new HttpError(413, "Результат провайдера больше допустимого размера");
  }
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > limit) {
        callback(new HttpError(413, "Результат провайдера больше допустимого размера"));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    counter,
    createWriteStream(target, { mode: 0o600 }),
  );
  return { mime, size };
}

function decodeBase64(base64: string, kind: MediaArtifact["kind"]): Buffer {
  const bytes = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ""), "base64");
  if (bytes.length > LIMITS[kind])
    throw new HttpError(413, "Результат провайдера больше допустимого размера");
  return bytes;
}

/** Сохраняет результат провайдера локально и возвращает артефакт для ответа. */
export async function saveArtifact(
  source: MediaArtifactSource,
  providerId: string,
  allowedHosts?: readonly string[],
): Promise<MediaArtifact> {
  if (source.kind === "text") {
    if (Buffer.byteLength(source.text, "utf8") > LIMITS.text)
      throw new HttpError(413, "Текстовый результат провайдера больше допустимого размера");
    return { kind: "text", mime: "text/plain", text: source.text };
  }
  await ensureLoaded();
  const store = state();
  await mkdir(filesDir(), { recursive: true });
  const extension = extensionFor(source.mime, source.kind);
  const id = artifactId(extension);
  const target = join(filesDir(), id);
  try {
    if ("url" in source) {
      const saved = await download(source.url, source.kind, source.mime, target, allowedHosts);
      const item: StoredArtifact = {
        id,
        providerId,
        kind: source.kind,
        mime: saved.mime,
        size: saved.size,
        createdAt: Date.now(),
      };
      store.items.set(id, item);
      await persist();
      return {
        kind: source.kind,
        mime: saved.mime,
        fileId: id,
        url: source.url,
        ...(source.expiresAt ? { expiresAt: source.expiresAt } : {}),
      };
    }
    const mime = safeMime(source.kind, source.mime);
    if (!mime) throw new HttpError(502, "Провайдер вернул недопустимый тип медиа-файла");
    const bytes = decodeBase64(source.base64, source.kind);
    await writeFile(target, bytes, { mode: 0o600 });
    store.items.set(id, {
      id,
      providerId,
      kind: source.kind,
      mime,
      size: bytes.length,
      createdAt: Date.now(),
    });
    await persist();
    return { kind: source.kind, mime, fileId: id };
  } catch (error) {
    if (store.items.delete(id)) await persist().catch(() => undefined);
    await unlink(target).catch(() => undefined);
    throw error;
  }
}

export async function discardArtifact(id: string): Promise<void> {
  if (!/^[a-f0-9]{24}\.[a-z0-9]{1,8}$/.test(id)) return;
  await ensureLoaded();
  state().items.delete(id);
  await unlink(join(filesDir(), id)).catch(() => undefined);
  await persist();
}

/** Метаданные скачанного файла; ссылки на произвольные пути здесь нет. */
export async function artifactFile(
  id: string,
): Promise<{ path: string; meta: StoredArtifact } | null> {
  if (!/^[a-f0-9]{24}\.[a-z0-9]{1,8}$/.test(id)) return null;
  await ensureLoaded();
  const meta = state().items.get(id);
  if (!meta) return null;
  return { path: join(filesDir(), id), meta };
}

/** Тестовый сброс: HMR-состояние не должно переживать смену каталога данных. */
export function resetMediaArtifacts(): void {
  const store = state();
  store.items.clear();
  store.loading = null;
  store.writing = Promise.resolve();
}
