import type {
  MediaArtifact,
  MediaCapability,
  MediaJob,
  MediaModel,
  MediaState,
} from "@ai-projector/core/modules/media/index.ts";
import { HttpError } from "../http/index.ts";
import {
  envFallbackFromProcess,
  loadStoredProviders,
  resolveOpenAIProvider,
} from "../providers/index.ts";
import { artifactFile, discardArtifact, saveArtifact } from "./artifacts.ts";
import {
  createMediaJob,
  isTerminalMediaStatus,
  mediaJobRecord,
  publicMediaJob,
  updateMediaJob,
  type MediaJobRecord,
} from "./jobs.ts";
import { POLL_TIMEOUT_MS, providerContext, resolveMediaProvider } from "./provider.ts";
import { mediaAdapter, mediaAdapters } from "./registry.ts";
import { parseRequest } from "./request.ts";
import type { MediaArtifactSource, MediaSubmission } from "./types.ts";

interface MediaOperations {
  poll?: Promise<MediaJob>;
  cancel?: Promise<MediaJob>;
}

const globalState = globalThis as typeof globalThis & {
  projectorMediaOperations?: Map<string, MediaOperations>;
};
const operations = (): Map<string, MediaOperations> =>
  (globalState.projectorMediaOperations ??= new Map());

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Провайдеры, для которых есть медиа-адаптер; ключи не читаются, чтобы список открывался без keyring. */
export async function mediaProviders(): Promise<MediaState> {
  const stored = await loadStoredProviders(envFallbackFromProcess());
  return {
    adapters: mediaAdapters().map((adapter) => ({
      kind: adapter.kind,
      capabilities: [...adapter.capabilities],
    })),
    providers: stored.providers
      .filter((provider) => provider.enabled && mediaAdapter(provider.kind))
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        kind: provider.kind,
        capabilities: [...(mediaAdapter(provider.kind)?.capabilities ?? [])],
      })),
  };
}
/** Все модели включённых провайдеров, у вида которых есть медиа-адаптер. */
export async function listMediaModels(capability?: MediaCapability): Promise<MediaModel[]> {
  const stored = await loadStoredProviders(envFallbackFromProcess());
  const out: MediaModel[] = [];
  for (const provider of stored.providers) {
    if (!provider.enabled || !provider.url.trim()) continue;
    const adapter = mediaAdapter(provider.kind);
    if (!adapter) continue;
    if (capability && !adapter.capabilities.includes(capability)) continue;
    const context = providerContext(provider.id, provider.name, provider.kind, provider.url, "");
    let models;
    try {
      models = await adapter.listModels(context);
    } catch (error) {
      console.error(`Медиа-модели ${provider.id}:`, (error as Error).message);
      continue;
    }
    for (const model of models) {
      if (capability && model.capability !== capability) continue;
      out.push({
        ...model,
        id: model.id,
        alias: model.alias ?? model.id,
        capability: model.capability,
        providerId: provider.id,
        providerName: provider.name,
        adapter: adapter.kind,
      });
    }
  }
  return out;
}

async function materialize(
  sources: MediaArtifactSource[],
  job: MediaJobRecord,
): Promise<MediaArtifact[]> {
  const artifacts: MediaArtifact[] = [];
  const allowedHosts = mediaAdapter(job.adapter)?.artifactHosts;
  try {
    for (const source of sources)
      artifacts.push(await saveArtifact(source, job.providerId, allowedHosts));
    return artifacts;
  } catch (error) {
    await Promise.all(
      artifacts.flatMap((artifact) =>
        artifact.fileId ? [discardArtifact(artifact.fileId).catch(() => undefined)] : [],
      ),
    );
    throw error;
  }
}

async function applySubmission(
  job: MediaJobRecord,
  submission: MediaSubmission,
): Promise<MediaJobRecord> {
  if (submission.status === "failed")
    return (
      updateMediaJob(job.id, {
        status: "failed",
        error: submission.error ?? "Задача провайдера завершилась ошибкой",
      }) ?? job
    );
  if (submission.status === "running")
    return (
      updateMediaJob(job.id, {
        status: "running",
        ...(submission.progress !== undefined ? { progress: submission.progress } : {}),
        ...(submission.upstreamId ? { upstreamId: submission.upstreamId } : {}),
      }) ?? job
    );
  const artifacts = await materialize(submission.artifacts ?? [], job);
  return (
    updateMediaJob(job.id, {
      status: "succeeded",
      artifacts,
      progress: 1,
      ...(submission.upstreamId ? { upstreamId: submission.upstreamId } : {}),
    }) ?? job
  );
}

/** Единая точка запуска: синхронный результат тоже становится задачей со статусом succeeded. */
export async function generateMedia(body: Record<string, unknown>): Promise<MediaJob> {
  const request = parseRequest(body);
  const { adapter, provider } = await resolveMediaProvider(request.providerId);
  if (!adapter.capabilities.includes(request.capability))
    throw new HttpError(400, `Адаптер «${adapter.kind}» не умеет ${request.capability}`);
  const catalog = await adapter.listModels(
    providerContext(provider.id, provider.name, provider.kind, provider.url, ""),
  );
  const knownModel = catalog.find((model) => model.id === request.model);
  if (knownModel && knownModel.capability !== request.capability)
    throw new HttpError(400, `Модель «${request.model}» не поддерживает ${request.capability}`);
  const job = createMediaJob({
    status: "queued",
    capability: request.capability,
    providerId: provider.id,
    providerName: provider.name,
    adapter: adapter.kind,
    model: request.model,
    artifacts: [],
  });
  try {
    const submission = await adapter.submit(
      providerContext(provider.id, provider.name, provider.kind, provider.url, provider.apiKey),
      request,
    );
    return publicMediaJob(await applySubmission(job, submission));
  } catch (error) {
    updateMediaJob(job.id, {
      status: "failed",
      error: error instanceof Error ? error.message : "Ошибка генерации",
    });
    throw error;
  }
}

function operationError(error: unknown, fallback: string): HttpError {
  const message = error instanceof Error ? error.message : fallback;
  return new HttpError(error instanceof HttpError ? error.status : 502, message);
}

async function pollMediaJob(existing: MediaJobRecord): Promise<MediaJob> {
  const adapter = mediaAdapter(existing.adapter);
  if (!adapter?.poll) {
    const failed = updateMediaJob(existing.id, {
      status: "failed",
      error: "Адаптер не умеет опрашивать задачи",
    });
    return publicMediaJob(failed ?? existing);
  }
  if (!existing.upstreamId) {
    const failed = updateMediaJob(existing.id, {
      status: "failed",
      error: "Задача потеряла идентификатор провайдера",
    });
    return publicMediaJob(failed ?? existing);
  }
  let submission: MediaSubmission;
  try {
    const provider = await resolveOpenAIProvider({ providerId: existing.providerId });
    submission = await adapter.poll(
      providerContext(
        provider.id,
        provider.name,
        provider.kind,
        provider.url,
        provider.apiKey,
        AbortSignal.timeout(POLL_TIMEOUT_MS),
      ),
      { job: publicMediaJob(existing), upstreamId: existing.upstreamId, model: existing.model },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка задачи";
    updateMediaJob(existing.id, { error: message });
    throw operationError(error, "Ошибка задачи");
  }
  try {
    const updated = await applySubmission(existing, submission);
    return publicMediaJob(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось сохранить результат";
    updateMediaJob(existing.id, { status: "failed", error: message });
    throw operationError(error, "Не удалось сохранить результат");
  }
}

export async function mediaJob(id: string): Promise<MediaJob> {
  const cancelling = operations().get(id)?.cancel;
  if (cancelling) await cancelling.catch(() => undefined);
  const existing = mediaJobRecord(id);
  if (!existing) throw new HttpError(404, "Медиа-задача не найдена");
  if (isTerminalMediaStatus(existing.status)) return publicMediaJob(existing);
  const currentOperations = operations().get(id) ?? {};
  if (currentOperations.poll) return currentOperations.poll;
  const pending = pollMediaJob(existing);
  currentOperations.poll = pending;
  operations().set(id, currentOperations);
  try {
    return await pending;
  } finally {
    if (currentOperations.poll === pending) {
      currentOperations.poll = undefined;
      if (!currentOperations.cancel) operations().delete(id);
    }
  }
}

export async function cancelMediaJob(id: string): Promise<MediaJob> {
  const existing = mediaJobRecord(id);
  if (!existing) throw new HttpError(404, "Медиа-задача не найдена");
  if (isTerminalMediaStatus(existing.status)) return publicMediaJob(existing);
  const currentOperations = operations().get(id) ?? {};
  if (currentOperations.cancel) return currentOperations.cancel;
  const pending = (async () => {
    if (currentOperations.poll) await currentOperations.poll.catch(() => undefined);
    const current = mediaJobRecord(id);
    if (!current) throw new HttpError(404, "Медиа-задача не найдена");
    if (isTerminalMediaStatus(current.status)) return publicMediaJob(current);
    const adapter = mediaAdapter(current.adapter);
    if (adapter?.cancel && current.upstreamId) {
      const provider = await resolveOpenAIProvider({ providerId: current.providerId });
      await adapter.cancel(
        providerContext(provider.id, provider.name, provider.kind, provider.url, provider.apiKey),
        publicMediaJob(current),
        current.upstreamId,
      );
    }
    const updated = updateMediaJob(id, { status: "cancelled" });
    return publicMediaJob(updated ?? current);
  })();
  currentOperations.cancel = pending;
  operations().set(id, currentOperations);
  try {
    return await pending;
  } finally {
    if (currentOperations.cancel === pending) {
      currentOperations.cancel = undefined;
      if (!currentOperations.poll) operations().delete(id);
    }
  }
}

export async function mediaFile(id: string) {
  const file = await artifactFile(id);
  if (!file) throw new HttpError(404, "Медиа-файл не найден");
  return file;
}

export async function temporaryMediaKey(body: Record<string, unknown>): Promise<{
  token: string;
  expiresAt: number;
}> {
  const { adapter, provider } = await resolveMediaProvider(text(body.providerId) || undefined);
  if (!adapter.temporaryKey)
    throw new HttpError(400, `Адаптер «${adapter.kind}» не выдаёт временные ключи`);
  const seconds = typeof body.expiresIn === "number" ? body.expiresIn : 600;
  return adapter.temporaryKey(
    providerContext(provider.id, provider.name, provider.kind, provider.url, provider.apiKey),
    seconds,
  );
}
