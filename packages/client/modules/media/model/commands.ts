import type {
  MediaCapability,
  MediaModel,
  MediaRequest,
  MediaState,
} from "@ai-projector/core/modules/media/index.ts";
import { isMediaCapability, MEDIA_CAPABILITIES } from "@ai-projector/core/modules/media/index.ts";
import {
  commandArgs,
  optionalStringArg,
  type CommandScope,
} from "../../../common/utilities/commands.ts";
import {
  cancelMediaJob,
  fetchMediaJob,
  fetchMediaModels,
  fetchMediaState,
  generateMedia,
} from "../api/client.ts";

export interface MediaModelsResult {
  state: MediaState;
  models: MediaModel[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function capabilityOf(args: Record<string, unknown>): MediaCapability | undefined {
  const value = optionalStringArg(args, "capability")?.trim();
  if (!value) return undefined;
  if (!isMediaCapability(value)) throw new Error("Неизвестная медиа-возможность");
  return value;
}

function requestOf(args: Record<string, unknown>): MediaRequest {
  const capability = capabilityOf(args);
  if (!capability) throw new Error("Укажите capability");
  const model = optionalStringArg(args, "model")?.trim();
  if (!model) throw new Error("Укажите model");
  const prompt = optionalStringArg(args, "prompt")?.trim();
  const providerId = optionalStringArg(args, "providerId")?.trim();
  const imageUrl = optionalStringArg(args, "imageUrl")?.trim();
  const audioUrl = optionalStringArg(args, "audioUrl")?.trim();
  const options = record(args.options);
  const supplied = record(args.input) as MediaRequest["input"];
  const input: NonNullable<MediaRequest["input"]> = { ...supplied };
  if (imageUrl) input.images = [...(input.images ?? []), { url: imageUrl }];
  if (audioUrl) input.audio = { url: audioUrl };
  return {
    capability,
    model,
    ...(prompt ? { prompt } : {}),
    ...(providerId ? { providerId } : {}),
    ...(Object.keys(input).length ? { input } : {}),
    ...(options ? { options } : {}),
  };
}

/** Models and providers in one read: the panel needs both, and the agent needs only the list. */
export async function loadMediaModels(capability?: MediaCapability): Promise<MediaModelsResult> {
  const [state, models] = await Promise.all([fetchMediaState(), fetchMediaModels(capability)]);
  return { state, models };
}

/**
 * Media commands of the workbench. They are registered once at app start, not by the media tab:
 * an agent can generate and read a job while the tab is closed, and the command returns the same
 * artifacts (with `fileUrl` and `widget`) that the HTTP API sends.
 */
export function registerMediaCommands(scope: CommandScope): void {
  scope.registerCommand({
    id: "ide.media.models.refresh",
    title: "Обновить медиа-модели",
    description:
      "Перечитывает провайдеров с медиа-адаптером и их модели: изображения, синтез речи, распознавание и видео. Возвращает state (провайдеры и адаптеры) и models с id, возможностью, провайдером и параметрами. Не требует открытой вкладки «Медиа».",
    arguments: {
      capability: MEDIA_CAPABILITIES.join(" | "),
    },
    run: async (value) => {
      const args = commandArgs(value);
      return loadMediaModels(capabilityOf(args));
    },
  });
  scope.registerCommand({
    id: "ide.media.generate",
    title: "Сгенерировать медиа",
    description:
      "Запускает выбранную медиа-модель и возвращает задачу с artifacts: fileId, fileUrl и готовым тегом widget. capability — image.generate, speech.synthesize, speech.transcribe или video.generate; model — id модели; prompt — текст, для синтеза речи — произносимый текст; imageUrl — публичная ссылка на исходное изображение; audioUrl — публичная ссылка на аудио для распознавания или озвучки; options — параметры провайдера (size, resolution, ratio, voice, duration). Если status равен queued или running, задачу опрашивает ide.media.job.refresh. Генерация платная и спрашивает подтверждение у агента.",
    arguments: {
      capability: MEDIA_CAPABILITIES.join(" | "),
      providerId: "id провайдера (необязательно)",
      model: "id модели у провайдера",
      prompt: "текст запроса или текст для синтеза речи",
      imageUrl: "публичная ссылка на исходное изображение (необязательно)",
      audioUrl: "публичная ссылка на аудио (необязательно)",
      options: "объект параметров, например { size, resolution, ratio, voice, duration }",
      input: "готовый объект input вместо ссылок (необязательно)",
    },
    run: async (value) => generateMedia(requestOf(commandArgs(value))),
  });
  scope.registerCommand({
    id: "ide.media.job.refresh",
    title: "Обновить медиа-задачу",
    description:
      "Перечитывает состояние медиа-задачи по id и, если она ещё выполняется, опрашивает провайдера. Возвращает artifacts с fileUrl и widget. Используется после ide.media.generate.",
    arguments: { id: "id задачи из ide.media.generate" },
    enabled: (value) => {
      try {
        return !!optionalStringArg(commandArgs(value), "id");
      } catch {
        return false;
      }
    },
    run: async (value) => fetchMediaJob(optionalStringArg(commandArgs(value), "id")!),
  });
  scope.registerCommand({
    id: "ide.media.job.cancel",
    title: "Отменить медиа-задачу",
    description:
      "Отменяет медиа-задачу по id у провайдера. Уже скачанные файлы остаются, а задача получает статус cancelled.",
    arguments: { id: "id задачи из ide.media.generate" },
    enabled: (value) => {
      try {
        return !!optionalStringArg(commandArgs(value), "id");
      } catch {
        return false;
      }
    },
    run: async (value) => cancelMediaJob(optionalStringArg(commandArgs(value), "id")!),
  });
}
