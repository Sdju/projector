import { computed, onScopeDispose, ref } from "vue";
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

/** Recordings that outlive their component: hot replacement must release the microphone too. */
const activeDictations = new Set<{ cancel: () => Promise<void> }>();

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const dictation of activeDictations) void dictation.cancel();
    activeDictations.clear();
  });

export function useDictation(options: {
  /** Saves the insertion point before every fresh recording, including one restarted from an error. */
  begin?: () => void;
  insert: (text: string) => void;
}) {
  const phase = ref<DictationPhase>("idle");
  const error = ref("");
  const elapsed = ref(0);
  const level = ref(0);
  const provider = ref("");
  const available = computed(() => dictationAvailable());
  let audio: ArrayBuffer | undefined;
  let controller: AbortController | undefined;
  let generation = 0;
  let disposed = false;
  const recorder = new DictationRecorder({
    level: (value) => (level.value = value),
    elapsed: (value) => (elapsed.value = value),
    limit: () => void stop(),
  });
  const activeEntry = { cancel: () => cancel() };
  activeDictations.add(activeEntry);

  async function start(): Promise<void> {
    if (disposed || (phase.value !== "idle" && phase.value !== "error")) return;
    try {
      options.begin?.();
    } catch {
      // A composer that is already gone has nowhere to put the text.
    }
    controller?.abort();
    audio = undefined;
    provider.value = "";
    error.value = "";
    elapsed.value = 0;
    phase.value = "recording";
    const current = ++generation;
    try {
      await recorder.start();
      if (disposed) await recorder.cancel();
      if (current !== generation) return;
    } catch (cause) {
      if (current !== generation || disposed) return;
      void recorder.cancel();
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
    if (disposed) return;
    audio = value;
    phase.value = "transcribing";
    error.value = "";
    controller = new AbortController();
    const current = ++generation;
    try {
      const result = await transcribe(value, controller.signal);
      if (current !== generation || disposed) return;
      options.insert(result.text);
      provider.value = [result.providerName, result.model].filter(Boolean).join(" · ");
      audio = undefined;
      phase.value = "idle";
      elapsed.value = 0;
    } catch (cause) {
      if (
        current !== generation ||
        disposed ||
        (cause instanceof DOMException && cause.name === "AbortError")
      )
        return;
      phase.value = "error";
      error.value = cause instanceof Error ? cause.message : "Не удалось распознать речь";
    }
  }

  async function stop(): Promise<void> {
    if (phase.value !== "recording" || disposed) return;
    phase.value = "transcribing";
    const current = ++generation;
    try {
      const value = await recorder.stop();
      if (current !== generation || disposed) return;
      await recognize(value);
    } catch (cause) {
      if (current !== generation || disposed) return;
      void recorder.cancel();
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
    try {
      await recorder.cancel();
    } catch {
      // Idle is already the truth; a broken close must not keep the error on screen.
    }
  }

  function toggle(): Promise<void> {
    return phase.value === "recording"
      ? stop()
      : phase.value === "idle"
        ? start()
        : Promise.resolve();
  }

  // Also runs when Vite replaces the component or hook module: a destroyed scope must not
  // leave a microphone open or let its late answer paste text into the new composer.
  onScopeDispose(() => {
    disposed = true;
    activeDictations.delete(activeEntry);
    void cancel();
  });
  return { phase, error, elapsed, level, provider, available, start, stop, retry, cancel, toggle };
}
