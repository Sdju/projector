import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { readGatewayState, saveGatewayEnabled, type GatewayState } from "./gateway-client.ts";

/** Переключатель OpenAI-совместимого API Projector для других приложений на машине. */
export function useGatewaySettings() {
  const state = shallowRef<GatewayState | null>(null);
  const busy = ref(false);
  const error = ref("");
  const ready = computed(() => state.value !== null);
  const enabled = computed(() => state.value?.enabled ?? false);
  const url = computed(() =>
    state.value ? `${window.location.origin}${state.value.baseUrl}` : "",
  );
  let disposed = false;
  let controller: AbortController | undefined;
  const commands = useCommandScope(`openai-gateway:${useId()}`, () => ({
    surface: "openaiGateway",
    ready: ready.value,
    busy: busy.value,
    enabled: enabled.value,
  }));

  async function perform(action: (signal: AbortSignal) => Promise<GatewayState>) {
    if (disposed || busy.value) throw new Error("Операция OpenAI API недоступна");
    busy.value = true;
    error.value = "";
    controller = new AbortController();
    try {
      const next = await action(controller.signal);
      if (!disposed) state.value = next;
      return next;
    } catch (err) {
      if (!disposed) error.value = err instanceof Error ? err.message : "Ошибка OpenAI API";
      throw err;
    } finally {
      controller = undefined;
      if (!disposed) busy.value = false;
    }
  }

  commands.scope.registerCommand({
    id: "ide.openai.gateway.refresh",
    title: "Обновить настройки OpenAI-совместимого API",
    description:
      "Перечитывает состояние API, которым другие приложения на машине пользуются провайдерами Projector.",
    enabled: () => !busy.value,
    run: () => perform(readGatewayState),
  });
  commands.scope.registerCommand({
    id: "ide.openai.gateway.set",
    title: "Включить или выключить OpenAI-совместимый API",
    description:
      "Включает или выключает OpenAI-совместимый API Projector (базовый адрес в поле url состояния). Включённый API тратит квоту провайдеров для любого локального процесса. Без аргумента переключает состояние.",
    arguments: { enabled: "true — включить, false — выключить; без аргумента — переключить" },
    enabled: () => ready.value && !busy.value,
    run: (value) => {
      const { enabled: next } = commandArgs(value);
      if (next !== undefined && typeof next !== "boolean") throw new Error("enabled: boolean");
      return perform((signal) => saveGatewayEnabled(next ?? !enabled.value, signal));
    },
  });
  onMounted(() => {
    void perform(readGatewayState).catch(() => {
      // The error is shown locally; refresh remains available for retry.
    });
  });
  onBeforeUnmount(() => {
    disposed = true;
    controller?.abort();
  });
  return { enabled, url, busy, error, ready, commands };
}
