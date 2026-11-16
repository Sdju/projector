import type {
  MediaCapability,
  MediaJob,
  MediaModel,
  MediaRequest,
  MediaState,
} from "@ai-projector/core/modules/media/index.ts";
import { mediaCapabilityTitle } from "@ai-projector/core/modules/media/index.ts";
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import { useIdeCommands } from "../../ide/index.ts";
import type { MediaModelsResult } from "./commands.ts";

const RUNNING = new Set(["queued", "running"]);
const MEDIA_SCOPE = "media";

/** Состояние раздела «Медиа»: провайдеры, модели, форма и одна активная задача. */
export function useMediaPanel() {
  const ide = useIdeCommands();
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

  function readModels(): Promise<MediaModelsResult> {
    return ide.api.executeCommand<MediaModelsResult>(
      "ide.media.models.refresh",
      {},
      { scope: MEDIA_SCOPE },
    );
  }

  async function load(): Promise<void> {
    if (dispose) return;
    loading.value = true;
    error.value = "";
    try {
      const result = await readModels();
      if (dispose) return;
      state.value = result.state;
      models.value = result.models;
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
      const result = await readModels();
      if (dispose) return;
      state.value = result.state;
      models.value = result.models;
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
      const next = await ide.api.executeCommand<MediaJob>(
        "ide.media.job.refresh",
        { id: job.value.id },
        { scope: MEDIA_SCOPE },
      );
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

  async function generate(): Promise<void> {
    if (dispose) throw new Error("Раздел медиа закрыт");
    if (!canGenerate.value) throw new Error("Заполните форму или выберите модель");
    submitting.value = true;
    error.value = "";
    try {
      const next = await ide.api.executeCommand<MediaJob>("ide.media.generate", requestBody(), {
        scope: MEDIA_SCOPE,
      });
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

  /** The form button reports the rejection here; the agent sees the same error from the command. */
  async function submit(): Promise<void> {
    await generate().catch(() => undefined);
  }

  async function cancel(): Promise<void> {
    if (!job.value || !running.value) return;
    try {
      job.value = await ide.api.executeCommand<MediaJob>(
        "ide.media.job.cancel",
        { id: job.value.id },
        { scope: MEDIA_SCOPE },
      );
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
    status: job.value?.status ?? null,
  }));

  // The other media commands are registered once at app level; only the local result is here.
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
    submit,
    cancel,
    clear,
    pollJob,
  };
}
