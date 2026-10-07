import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import { isNetworkMode, type NetworkMode } from "../../../core/modules/network-mode/index.ts";
import {
  commandArgs,
  optionalStringArg,
  useCommandScope,
} from "../../common/utilities/commands.ts";
import {
  networkServerPid,
  readNetworkState,
  saveNetworkState,
  waitForNetworkRestart,
  type NetworkState,
} from "./client.ts";

/** Общие операции; каждый экран сохраняет собственные черновики режима и пароля. */
export function useNetworkSettings(view: "settings" | "panel") {
  const state = shallowRef<NetworkState | null>(null);
  const mode = ref<NetworkMode>("local");
  const password = ref("");
  const busy = ref(false);
  const error = ref("");
  const status = ref("");
  const ready = computed(() => state.value !== null);
  const passwordRequired = computed(() => state.value?.passwordRequired ?? false);
  const lanUrl = computed(() => state.value?.lanUrl ?? null);
  let disposed = false;
  let controller: AbortController | undefined;
  const commands = useCommandScope(`network:${view}:${useId()}`, () => ({
    surface: "network",
    view,
    mode: state.value?.mode ?? "",
    ready: ready.value,
    busy: busy.value,
    passwordRequired: passwordRequired.value,
  }));

  async function load(signal: AbortSignal) {
    const data = await readNetworkState(signal);
    signal.throwIfAborted();
    state.value = data;
    mode.value = data.mode;
    return data;
  }

  async function perform<T>(action: (signal: AbortSignal) => Promise<T>) {
    if (disposed || busy.value) throw new Error("Операция доступа по сети недоступна");
    busy.value = true;
    error.value = "";
    status.value = "";
    controller = new AbortController();
    try {
      return await action(controller.signal);
    } catch (err) {
      if (disposed) return;
      error.value = err instanceof Error ? err.message : "Не удалось сохранить доступ по сети";
      status.value = "";
      throw err;
    } finally {
      controller = undefined;
      if (!disposed) busy.value = false;
    }
  }

  async function apply(nextMode: NetworkMode, nextPassword: string | undefined) {
    return perform(async (signal) => {
      const pid = await networkServerPid(signal);
      signal.throwIfAborted();
      if (nextMode !== state.value?.mode && pid === null)
        throw new Error("Не удалось определить PID сервера перед сменой режима");
      const result = await saveNetworkState(nextMode, nextPassword, signal);
      signal.throwIfAborted();
      if (result.restarted) {
        status.value = "Сервер перезапускается…";
        if (pid === null) throw new Error("Не удалось определить PID перезапускаемого сервера");
        await waitForNetworkRestart(pid, signal);
        signal.throwIfAborted();
        password.value = "";
        window.location.reload();
      } else {
        await load(signal);
        password.value = "";
        status.value = "Сохранено";
      }
      return result;
    });
  }

  const available = () => ready.value && !busy.value;
  commands.scope.registerCommand({
    id: "ide.network.refresh",
    title: "Обновить настройки доступа по сети",
    description: "Перечитывает режим, наличие пароля и LAN-адреса; сбрасывает черновик режима.",
    enabled: () => !busy.value,
    run: () => perform(load),
  });
  commands.scope.registerCommand({
    id: "ide.network.save",
    title: "Сохранить доступ по сети",
    description:
      "Сохраняет режим local/lan и новый пароль. Без аргументов использует поля текущего экрана; пустое поле сохраняет прежний пароль. Явный password='' удаляет пароль. Смена режима перезапускает сервер и завершает терминалы и дочерние процессы; пароль меняется без рестарта.",
    arguments: {
      mode: "local или lan; без аргумента — режим из текущего экрана",
      password: "Новый пароль; без аргумента — непустое поле экрана; пустая строка — убрать пароль",
    },
    enabled: available,
    run: (value) => {
      const args = commandArgs(value);
      const nextMode = args.mode ?? mode.value;
      if (!isNetworkMode(nextMode)) throw new Error("Режим: local или lan");
      const nextPassword = optionalStringArg(args, "password") ?? (password.value || undefined);
      return apply(nextMode, nextPassword);
    },
  });
  commands.scope.registerCommand({
    id: "ide.network.password.clear",
    title: "Убрать пароль доступа по сети",
    description:
      "Удаляет пароль доступа. Сохраняет режим из текущего экрана; если режим изменён, перезапускает сервер и завершает терминалы и дочерние процессы.",
    enabled: () => available() && passwordRequired.value,
    run: () => apply(mode.value, ""),
  });
  onMounted(() => {
    void perform(load).catch(() => {
      // Initial failures are shown locally; refresh remains available for retry.
    });
  });
  onBeforeUnmount(() => {
    disposed = true;
    controller?.abort();
  });
  return { state, mode, password, busy, error, status, ready, passwordRequired, lanUrl, commands };
}
