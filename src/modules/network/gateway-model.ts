import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import {
  commandArgs,
  optionalStringArg,
  useCommandScope,
} from "../../common/utilities/commands.ts";
import { readGatewayState, saveGatewayState, type GatewayState } from "./gateway-client.ts";

/** Переключатель OpenAI-совместимого API Projector для других приложений на машине. */
export function useGatewaySettings() {
  const state = shallowRef<GatewayState | null>(null);
  const apiKey = ref("");
  const busy = ref(false);
  const error = ref("");
  const ready = computed(() => state.value !== null);
  const enabled = computed(() => state.value?.enabled ?? false);
  const hasKey = computed(() => state.value?.hasKey ?? false);
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
    hasKey: hasKey.value,
  }));

  async function perform(action: (signal: AbortSignal) => Promise<GatewayState>) {
    if (disposed || busy.value) throw new Error("Операция OpenAI API недоступна");
    busy.value = true;
    error.value = "";
    controller = new AbortController();
    try {
      const next = await action(controller.signal);
      if (!disposed) {
        state.value = next;
        apiKey.value = "";
      }
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
    title: "Настроить OpenAI-совместимый API",
    description:
      "Включает или выключает OpenAI-совместимый API Projector и задаёт ключ доступа (Bearer). Включённый API тратит квоту провайдеров и доступен с любого origin; без ключа — любому локальному процессу и странице в браузере. Без аргументов сохраняет поле ключа экрана, а при пустом поле переключает состояние.",
    arguments: {
      enabled: "true — включить, false — выключить; без аргумента состояние не меняется",
      apiKey: "Новый ключ; пустая строка — убрать ключ; без аргумента ключ не меняется",
    },
    enabled: () => ready.value && !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (args.enabled !== undefined && typeof args.enabled !== "boolean")
        throw new Error("enabled: boolean");
      const change: { enabled?: boolean; apiKey?: string } = {};
      if (args.enabled !== undefined) change.enabled = args.enabled;
      // The screen's draft is saved only by a bare call, never alongside a toggle.
      const draft = Object.keys(args).length === 0 ? apiKey.value.trim() || undefined : undefined;
      const key = optionalStringArg(args, "apiKey") ?? draft;
      if (key !== undefined) change.apiKey = key;
      if (Object.keys(change).length === 0) change.enabled = !enabled.value;
      return perform((signal) => saveGatewayState(change, signal));
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
  return { enabled, hasKey, apiKey, url, busy, error, ready, commands };
}
