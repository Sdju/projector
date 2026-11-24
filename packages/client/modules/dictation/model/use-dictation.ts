import { computed, onBeforeUnmount, ref } from "vue";
import { DictationRecorder, dictationAvailable } from "./recorder.ts";

export type DictationPhase = "idle" | "recording" | "transcribing" | "error";

interface ListenerResult {
  text?: unknown;
  error?: unknown;
  providerName?: unknown;
  model?: unknown;
}

function base64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Не удалось подготовить запись"));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(new Blob([buffer], { type: "audio/wav" }));
  });
}

async function transcribe(
  audio: ArrayBuffer,
  signal: AbortSignal,
): Promise<{ text: string; providerName?: string; model?: string }> {
  const response = await fetch("/api/agent/listener/transcribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audio: { base64: await base64(audio), mime: "audio/wav" } }),
    signal,
  });
  const data = (await response.json().catch(() => ({}))) as ListenerResult;
  if (!response.ok)
    throw new Error(typeof data.error === "string" ? data.error : "Не удалось распознать речь");
  const text = typeof data.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("Модель не вернула текст распознавания");
  return {
    text,
    ...(typeof data.providerName === "string" ? { providerName: data.providerName } : {}),
    ...(typeof data.model === "string" ? { model: data.model } : {}),
  };
}

export function useDictation(options: { insert: (text: string) => void }) {
  const phase = ref<DictationPhase>("idle");
  const error = ref("");
  const elapsed = ref(0);
  const level = ref(0);
  const provider = ref("");
  const available = computed(() => dictationAvailable());
  let audio: ArrayBuffer | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  const recorder = new DictationRecorder({
    level: (value) => (level.value = value),
    elapsed: (value) => (elapsed.value = value),
    limit: () => void stop(),
  });

  async function start(): Promise<void> {
    if (phase.value !== "idle" && phase.value !== "error") return;
    controller?.abort();
    audio = undefined;
    provider.value = "";
    error.value = "";
    elapsed.value = 0;
    phase.value = "recording";
    const current = ++generation;
    try {
      await recorder.start();
      if (current !== generation) await recorder.cancel();
    } catch (cause) {
      if (current !== generation) return;
      phase.value = "error";
      error.value =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Разрешите доступ к микрофону в браузере"
          : cause instanceof Error
            ? cause.message
            : "Не удалось начать запись";
    }
  }

  async function recognize(value: ArrayBuffer): Promise<void> {
    audio = value;
    phase.value = "transcribing";
    error.value = "";
    controller = new AbortController();
    const current = ++generation;
    try {
      const result = await transcribe(value, controller.signal);
      if (current !== generation) return;
      options.insert(result.text);
      provider.value = [result.providerName, result.model].filter(Boolean).join(" · ");
      audio = undefined;
      phase.value = "idle";
      elapsed.value = 0;
    } catch (cause) {
      if (current !== generation || (cause instanceof DOMException && cause.name === "AbortError"))
        return;
      phase.value = "error";
      error.value = cause instanceof Error ? cause.message : "Не удалось распознать речь";
    }
  }

  async function stop(): Promise<void> {
    if (phase.value !== "recording") return;
    phase.value = "transcribing";
    const current = ++generation;
    try {
      const value = await recorder.stop();
      if (current !== generation) return;
      await recognize(value);
    } catch (cause) {
      if (current !== generation) return;
      phase.value = "error";
      error.value = cause instanceof Error ? cause.message : "Не удалось завершить запись";
    }
  }

  async function retry(): Promise<void> {
    if (audio) await recognize(audio);
    else await start();
  }

  async function cancel(): Promise<void> {
    generation++;
    controller?.abort();
    controller = undefined;
    audio = undefined;
    provider.value = "";
    error.value = "";
    elapsed.value = 0;
    phase.value = "idle";
    await recorder.cancel();
  }

  function toggle(): Promise<void> {
    return phase.value === "recording"
      ? stop()
      : phase.value === "idle"
        ? start()
        : Promise.resolve();
  }

  onBeforeUnmount(() => void cancel());
  return { phase, error, elapsed, level, provider, available, start, stop, retry, cancel, toggle };
}
