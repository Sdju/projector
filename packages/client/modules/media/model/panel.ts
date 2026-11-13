import type {
  MediaCapability,
  MediaJob,
  MediaModel,
  MediaRequest,
  MediaState,
} from "@ai-projector/core/modules/media/index.ts";
import { mediaCapabilityTitle } from "@ai-projector/core/modules/media/index.ts";
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import {
  commandArgs,
  optionalStringArg,
  useCommandScope,
} from "../../../common/utilities/commands.ts";
import {
  cancelMediaJob,
  fetchMediaJob,
  fetchMediaModels,
  fetchMediaState,
  generateMedia,
} from "../api/client.ts";

const RUNNING = new Set(["queued", "running"]);

/** Состояние раздела «Медиа»: провайдеры, модели, форма и одна активная задача. */
export function useMediaPanel() {
  const state = ref<MediaState | null>(null);
  const models = ref<MediaModel[]>([]);
  const loading = ref(false);
  const refreshing = ref(false);
  const submitting = ref(false);
  const error = ref("");
  const capability = ref<MediaCapability>("image.generate");
  const providerId = ref("");
  const modelId = ref("");
  const prompt = ref("");
  const imageUrl = ref("");
  const audioUrl = ref("");
  const size = ref("");
  const resolution = ref("");
  const ratio = ref("");
  const voice = ref("");
  const duration = ref<number | null>(null);
  const job = ref<MediaJob | null>(null);
  let dispose = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const capabilityOptions = computed(() => {
    const map = new Map<MediaCapability, string>();
    for (const provider of state.value?.providers ?? [])
      for (const item of provider.capabilities)
        if (!map.has(item)) map.set(item, mediaCapabilityTitle(item));
    return [...map].map(([value, label]) => ({ value, label }));
  });

  const capabilityModels = computed(() =>
    models.value.filter((model) => model.capability === capability.value),
  );
  const providerOptions = computed(() => {
    const map = new Map<string, string>();
    for (const model of capabilityModels.value) map.set(model.providerId, model.providerName);
    return [...map].map(([id, name]) => ({ id, name }));
  });
  const modelOptions = computed(() =>
    capabilityModels.value.filter((model) => model.providerId === providerId.value),
  );
  const selectedModel = computed(() =>
    models.value.find(
      (model) =>
        model.capability === capability.value &&
        model.providerId === providerId.value &&
        model.id === modelId.value,
    ),
  );
  const running = computed(() => job.value !== null && RUNNING.has(job.value.status));
  const busy = computed(() => submitting.value || running.value);
  const canGenerate = computed(() => {
    if (busy.value || !selectedModel.value) return false;
    if (capability.value === "speech.transcribe") return Boolean(audioUrl.value.trim());
    return Boolean(prompt.value.trim());
  });
  const ready = computed(() => (state.value?.providers.length ?? 0) > 0);

  function applyDefaults() {
    const options = selectedModel.value?.options;
    const defaults = options?.defaults ?? {};
    size.value = typeof defaults.size === "string" ? defaults.size : (options?.sizes?.[0] ?? "");
    resolution.value =
      typeof defaults.resolution === "string"
        ? defaults.resolution
        : (options?.resolutions?.[0] ?? "");
    ratio.value =
      typeof defaults.ratio === "string" ? defaults.ratio : (options?.ratios?.[0] ?? "");
    voice.value =
      typeof defaults.voice === "string" ? defaults.voice : (options?.voices?.[0] ?? "");
    duration.value =
      typeof defaults.duration === "number" ? defaults.duration : (options?.durations?.[0] ?? null);
  }

  function syncSelection() {
    const capabilities = capabilityOptions.value.map((item) => item.value);
    if (!capabilities.length) return;
    if (!capabilities.includes(capability.value)) capability.value = capabilities[0]!;
    const providers = providerOptions.value.map((item) => item.id);
    if (!providers.includes(providerId.value)) providerId.value = providers[0] ?? "";
    const nextModels = modelOptions.value.map((item) => item.id);
    const modelChanged = !nextModels.includes(modelId.value) || !selectedModel.value;
    if (modelChanged) {
      modelId.value = nextModels[0] ?? "";
      applyDefaults();
    }
  }

  function setCapability(value: unknown): void {
    if (typeof value !== "string") return;
    if (!capabilityOptions.value.some((item) => item.value === value)) return;
    capability.value = value as MediaCapability;
    providerId.value = "";
    modelId.value = "";
    syncSelection();
  }

  function setProvider(value: unknown): void {
    if (typeof value !== "string") return;
    providerId.value = value;
    modelId.value = "";
    syncSelection();
  }

  function setModel(value: unknown): void {
    if (typeof value !== "string") return;
    modelId.value = value;
    applyDefaults();
  }

  async function load(): Promise<void> {
    if (dispose) return;
    loading.value = true;
    error.value = "";
    try {
      const [nextState, nextModels] = await Promise.all([fetchMediaState(), fetchMediaModels()]);
      if (dispose) return;
      state.value = nextState;
      models.value = nextModels;
      syncSelection();
    } catch (err) {
      if (!dispose)
        error.value = err instanceof Error ? err.message : "Не удалось загрузить модели";
    } finally {
      if (!dispose) loading.value = false;
    }
  }

  async function refreshModels(): Promise<void> {
    if (dispose || refreshing.value) return;
    refreshing.value = true;
    error.value = "";
    try {
      const [nextState, nextModels] = await Promise.all([fetchMediaState(), fetchMediaModels()]);
      if (dispose) return;
      state.value = nextState;
      models.value = nextModels;
      syncSelection();
    } catch (err) {
      if (!dispose) error.value = err instanceof Error ? err.message : "Не удалось обновить модели";
    } finally {
      if (!dispose) refreshing.value = false;
    }
  }

  function stopPolling(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
  }

  function startPolling(): void {
    stopPolling();
    if (!job.value || !RUNNING.has(job.value.status)) return;
    timer = setTimeout(() => void pollJob(), 1500);
  }

  async function pollJob(): Promise<void> {
    if (dispose || !job.value) return;
    try {
      const next = await fetchMediaJob(job.value.id);
      if (dispose) return;
      job.value = next;
      error.value = "";
      if (RUNNING.has(next.status)) startPolling();
      else stopPolling();
    } catch (err) {
      if (!dispose)
        error.value = err instanceof Error ? err.message : "Не удалось прочитать задачу";
      startPolling();
    }
  }

  function requestBody(): MediaRequest {
    const model = selectedModel.value;
    if (!model) throw new Error("Выберите модель");
    const options: Record<string, unknown> = {};
    if (size.value) options.size = size.value;
    if (resolution.value) options.resolution = resolution.value;
    if (ratio.value) options.ratio = ratio.value;
    if (voice.value) options.voice = voice.value;
    if (duration.value !== null) options.duration = duration.value;
    if (capability.value === "speech.transcribe")
      return {
        capability: capability.value,
        providerId: providerId.value,
        model: model.id,
        input: { audio: { url: audioUrl.value.trim() } },
        ...(Object.keys(options).length ? { options } : {}),
      };
    if (capability.value === "speech.synthesize")
      return {
        capability: capability.value,
        providerId: providerId.value,
        model: model.id,
        input: { text: prompt.value.trim() },
        ...(Object.keys(options).length ? { options } : {}),
      };
    return {
      capability: capability.value,
      providerId: providerId.value,
      model: model.id,
      prompt: prompt.value.trim(),
      ...(imageUrl.value.trim() ? { input: { images: [{ url: imageUrl.value.trim() }] } } : {}),
      ...(Object.keys(options).length ? { options } : {}),
    };
  }

  async function generate(override?: Record<string, unknown>): Promise<void> {
    if (dispose) throw new Error("Раздел медиа закрыт");
    if (override && Object.keys(override).length) {
      const nextCapability = optionalStringArg(override, "capability");
      if (nextCapability) {
        if (!capabilityOptions.value.some((item) => item.value === nextCapability))
          throw new Error("Неизвестная медиа-возможность");
        setCapability(nextCapability);
      }
      const nextProvider = optionalStringArg(override, "providerId");
      if (nextProvider) setProvider(nextProvider);
      const nextModel = optionalStringArg(override, "model");
      if (nextModel) setModel(nextModel);
      const nextPrompt = optionalStringArg(override, "prompt");
      if (nextPrompt !== undefined) prompt.value = nextPrompt;
      const nextImage = optionalStringArg(override, "imageUrl");
      if (nextImage !== undefined) imageUrl.value = nextImage;
      const nextAudio = optionalStringArg(override, "audioUrl");
      if (nextAudio !== undefined) audioUrl.value = nextAudio;
      const nextOptions = override.options;
      if (nextOptions !== undefined) {
        if (!nextOptions || typeof nextOptions !== "object" || Array.isArray(nextOptions))
          throw new Error("options: объект");
        const values = nextOptions as Record<string, unknown>;
        if (typeof values.size === "string") size.value = values.size;
        if (typeof values.resolution === "string") resolution.value = values.resolution;
        if (typeof values.ratio === "string") ratio.value = values.ratio;
        if (typeof values.voice === "string") voice.value = values.voice;
        if (typeof values.duration === "number") duration.value = values.duration;
      }
      syncSelection();
    }
    if (!canGenerate.value) throw new Error("Заполните форму или выберите модель");
    submitting.value = true;
    error.value = "";
    try {
      const next = await generateMedia(requestBody());
      if (dispose) return;
      job.value = next;
      startPolling();
    } catch (err) {
      if (!dispose)
        error.value = err instanceof Error ? err.message : "Не удалось запустить генерацию";
      throw err;
    } finally {
      if (!dispose) submitting.value = false;
    }
  }

  async function cancel(): Promise<void> {
    if (!job.value || !running.value) return;
    try {
      job.value = await cancelMediaJob(job.value.id);
      stopPolling();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось отменить задачу";
    }
  }

  function clear(): void {
    stopPolling();
    job.value = null;
    error.value = "";
  }

  const commands = useCommandScope(`media-panel:${useId()}`, () => ({
    surface: "mediaPanel",
    capability: capability.value,
    provider: providerId.value,
    model: modelId.value,
    status: job.value?.status ?? null,
    ready: ready.value,
    busy: busy.value,
  }));

  commands.scope.registerCommand({
    id: "ide.media.models.refresh",
    title: "Обновить медиа-модели",
    description:
      "Перечитывает провайдеров с медиа-адаптером и их модели: изображения, синтез речи, распознавание и видео.",
    enabled: () => !loading.value && !refreshing.value,
    run: () => refreshModels(),
  });
  commands.scope.registerCommand({
    id: "ide.media.generate",
    title: "Сгенерировать медиа",
    description:
      "Запускает выбранную медиа-модель. Без аргументов берёт форму экрана; capability — image.generate, speech.synthesize, speech.transcribe или video.generate, model — id модели, prompt — текст, audioUrl — публичная ссылка на аудио, options — параметры провайдера (size, voice, duration). Видео и async-изображения возвращают задачу, раздел сам опрашивает её.",
    arguments: {
      capability: "image.generate | speech.synthesize | speech.transcribe | video.generate",
      providerId: "id провайдера (необязательно)",
      model: "id модели у провайдера",
      prompt: "текст запроса",
      imageUrl: "публичная ссылка на исходное изображение (необязательно)",
      audioUrl: "публичная ссылка на аудио для распознавания",
      options: "объект параметров, например { size, resolution, ratio, voice, duration }",
    },
    enabled: () => ready.value && !busy.value,
    run: (value) => generate(commandArgs(value)),
  });
  commands.scope.registerCommand({
    id: "ide.media.job.refresh",
    title: "Обновить медиа-задачу",
    description: "Перечитывает состояние текущей задачи и её артефакты.",
    enabled: () => job.value !== null,
    run: () => pollJob(),
  });
  commands.scope.registerCommand({
    id: "ide.media.job.cancel",
    title: "Отменить медиа-задачу",
    description: "Отменяет текущую задачу у провайдера. Уже скачанные файлы остаются.",
    enabled: () => running.value,
    run: () => cancel(),
  });
  commands.scope.registerCommand({
    id: "ide.media.result.clear",
    title: "Очистить результат медиа",
    description:
      "Убирает результат и состояние текущей задачи с экрана; файлы в каталоге медиа остаются.",
    enabled: () => job.value !== null,
    run: () => clear(),
  });

  onMounted(() => void load());
  onBeforeUnmount(() => {
    dispose = true;
    stopPolling();
  });

  return {
    state,
    models,
    loading,
    refreshing,
    submitting,
    error,
    capability,
    providerId,
    modelId,
    prompt,
    imageUrl,
    audioUrl,
    size,
    resolution,
    ratio,
    voice,
    duration,
    job,
    capabilityOptions,
    providerOptions,
    modelOptions,
    selectedModel,
    running,
    busy,
    canGenerate,
    ready,
    commands,
    load,
    refreshModels,
    setCapability,
    setProvider,
    setModel,
    generate,
    cancel,
    clear,
    pollJob,
  };
}
