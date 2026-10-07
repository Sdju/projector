import { computed, inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey } from "vue";
import type {
  DockerSnapshot,
  DockerBinding,
  DockerAction,
} from "../../../core/modules/docker/index.ts";
import type { TerminalSession } from "../../../core/modules/terminal/index.ts";
import { commandArgs, useCommandScope } from "../../common/utilities/commands.ts";
import { openExternalLink } from "../../common/utilities/open-external-link.ts";
import { dockerRequest } from "./client.ts";

export function useDocker(
  projectId: string,
  hooks: {
    enabled?: boolean;
    open: () => void;
    sidebar: () => void;
    terminal: (session: TerminalSession) => Promise<void>;
  },
) {
  const snapshot = ref<DockerSnapshot>();
  const error = ref("");
  const busy = ref(false);
  const all = ref(false);
  const selected = ref("");
  const context = ref("");
  const commands = useCommandScope(`docker:${projectId}`, () => ({
    surface: "docker",
    projectId,
    context: snapshot.value?.context ?? "",
    busy: busy.value,
  }));
  let disposed = false;
  let refreshing = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const projectContainers = computed(() => {
    const data = snapshot.value;
    const binding = data?.binding;
    if (!data || !binding || binding.context !== data.context) return [];
    return data.containers.filter((item) => item.project === binding.name);
  });
  const containers = computed(() =>
    all.value ? (snapshot.value?.containers ?? []) : projectContainers.value,
  );
  const current = computed(() => containers.value.find((item) => item.id === selected.value));
  async function refresh() {
    if (refreshing) return snapshot.value;
    refreshing = true;
    const version = ++generation;
    try {
      const result = await dockerRequest<DockerSnapshot>(
        "",
        projectId,
        "GET",
        undefined,
        context.value ? { context: context.value } : {},
      );
      if (!disposed && version === generation) {
        snapshot.value = result;
        error.value = "";
      }
      return result;
    } catch (err) {
      if (!disposed && version === generation) {
        error.value = err instanceof Error ? err.message : "Docker недоступен";
        if (snapshot.value)
          snapshot.value = { ...snapshot.value, connected: false, containers: [] };
      }
      throw err;
    } finally {
      refreshing = false;
    }
  }
  const ready = () => !!snapshot.value?.connected && !busy.value;
  async function perform(task: () => Promise<unknown>) {
    if (busy.value) throw new Error("Дождитесь текущего Docker-действия");
    busy.value = true;
    try {
      while (refreshing) await new Promise((resolve) => setTimeout(resolve, 25));
      return await task();
    } finally {
      busy.value = false;
    }
  }
  const register = (
    id: string,
    title: string,
    description: string,
    run: (args: Record<string, unknown>) => unknown,
    enabled: (args: Record<string, unknown>) => boolean = () => true,
    args?: Record<string, string>,
  ) => {
    commands.scope.registerCommand({
      id: `ide.docker.${id}`,
      title,
      description,
      arguments: args,
      enabled: (value) => hooks.enabled !== false && enabled(commandArgs(value)),
      run: (value) => run(commandArgs(value)),
    });
  };
  register(
    "open",
    "Открыть Docker",
    "Открывает Docker во вкладке проекта; all=true показывает все контейнеры выбранного context.",
    (args) => {
      all.value = args.all === true;
      if (typeof args.containerId === "string") selected.value = args.containerId;
      hooks.open();
    },
    () => true,
    { all: "true — все контейнеры машины", containerId: "Выбрать контейнер" },
  );
  register(
    "status",
    "Получить состояние Docker",
    "Возвращает daemon, contexts, Compose-привязку, контейнеры, health и опубликованные порты.",
    refresh,
  );
  register(
    "sidebar.open",
    "Показать Docker в боковой панели",
    "Открывает сервисы текущего проекта в боковой панели.",
    hooks.sidebar,
  );
  register(
    "refresh",
    "Обновить Docker",
    "Перечитывает состояние выбранного Docker context.",
    refresh,
    () => !refreshing,
  );
  register(
    "context.select",
    "Выбрать Docker context",
    "Меняет окружение просмотра внутри Projector, не меняя глобальный context Docker CLI.",
    async (args) => {
      if (
        typeof args.context !== "string" ||
        !snapshot.value?.contexts.some((item) => item.name === args.context && item.local)
      )
        throw new Error("Выберите локальный context");
      context.value = args.context;
      selected.value = "";
      snapshot.value = undefined;
      ++generation;
      while (refreshing) await new Promise((resolve) => setTimeout(resolve, 25));
      return refresh();
    },
    () => !busy.value,
    { context: "Имя локального Docker context" },
  );
  register(
    "container.select",
    "Показать контейнер",
    "Выбирает контейнер и показывает порты, образ, health и mounts.",
    (args) => {
      if (
        typeof args.containerId !== "string" ||
        !snapshot.value?.containers.some((item) => item.id === args.containerId)
      )
        throw new Error("Контейнер не найден");
      selected.value = args.containerId;
    },
    ready,
    { containerId: "Полный ID контейнера" },
  );
  register(
    "binding.save",
    "Привязать Compose к проекту",
    "Сохраняет context, name, files, profiles, envFiles на диске. Ничего не запускает. binding=null удаляет привязку.",
    (args) =>
      perform(async () => {
        const result = await dockerRequest<{ binding: DockerBinding | null }>(
          "/binding",
          projectId,
          "PUT",
          args,
        );
        context.value = result.binding?.context ?? "";
        await refresh();
        return result;
      }),
    () => !busy.value && !!snapshot.value?.enabled,
    {
      context: "Docker context",
      name: "Compose project name",
      files: "Упорядоченный список Compose-файлов относительно проекта",
      profiles: "Список profiles",
      envFiles: "Список env-файлов",
      binding: "null — отвязать",
    },
  );
  register(
    "logs.read",
    "Прочитать логи контейнера",
    "Возвращает последние 200 строк логов; не открывает терминал.",
    (args) => {
      const id = args.containerId ?? selected.value;
      if (typeof id !== "string" || !snapshot.value?.containers.some((item) => item.id === id))
        throw new Error("Выберите контейнер");
      return dockerRequest("/logs", projectId, "GET", undefined, {
        context: snapshot.value.context,
        containerId: id,
      });
    },
    ready,
    { containerId: "Полный ID контейнера" },
  );
  const actions: [DockerAction, string, string][] = [
    ["start", "Запустить контейнер", "Запускает существующий контейнер."],
    ["stop", "Остановить контейнер", "Останавливает контейнер с таймаутом 10 секунд."],
    [
      "restart",
      "Перезапустить контейнер",
      "Прерывает текущие процессы контейнера и запускает его снова.",
    ],
    [
      "remove",
      "Удалить контейнер",
      "Удаляет остановленный контейнер; volumes сохраняются. confirm=true подтверждает удаление.",
    ],
    [
      "logs",
      "Открыть логи контейнера",
      "Открывает поток docker logs в терминальной вкладке; закрытие вкладки оставляет контейнер работать.",
    ],
    [
      "shell",
      "Открыть shell контейнера",
      "Открывает docker exec -it с sh или bash в настоящем PTY. Закрытие клиента не гарантирует завершение запущенных внутри задач.",
    ],
    [
      "up",
      "Поднять Compose",
      "Создаёт и запускает окружение из сохранённой привязки; может собирать и скачивать образы.",
    ],
    ["composeStop", "Остановить Compose", "Останавливает сервисы, сохраняя контейнеры и данные."],
    [
      "composeRestart",
      "Перезапустить Compose",
      "Перезапускает сервисы и прерывает их текущие процессы.",
    ],
    [
      "down",
      "Удалить Compose-окружение",
      "Останавливает и удаляет контейнеры и сети. Volumes сохраняются. confirm=true подтверждает удаление.",
    ],
    [
      "build",
      "Собрать Compose",
      "Собирает образы; прогресс и код завершения показаны в терминале.",
    ],
    ["pull", "Скачать образы Compose", "Скачивает образы сервисов; прогресс показан в терминале."],
  ];
  for (const [action, title, description] of actions) {
    const compose = ["up", "composeStop", "composeRestart", "down", "build", "pull"].includes(
      action,
    );
    register(
      action,
      title,
      description,
      (args) =>
        perform(async () => {
          const containerId = args.containerId ?? selected.value;
          if (!compose && !snapshot.value?.containers.some((item) => item.id === containerId))
            throw new Error("Выберите контейнер");
          if (
            (action === "remove" || action === "down") &&
            args.confirm !== true &&
            !window.confirm(
              `${title}? Контекст: ${snapshot.value!.context}. Объект: ${compose ? snapshot.value!.binding?.name : snapshot.value!.containers.find((item) => item.id === containerId)?.name}. Volumes сохраняются.`,
            )
          )
            return;
          const result = await dockerRequest<{ session: TerminalSession }>(
            "/action",
            projectId,
            "POST",
            {
              ...args,
              action,
              containerId: compose ? undefined : containerId,
              context: snapshot.value!.context,
              confirm: action === "remove" || action === "down" ? true : undefined,
            },
          );
          await hooks.terminal(result.session);
          await refresh();
          return result;
        }),
      (args) => {
        if (!ready()) return false;
        if (compose)
          return (
            !!snapshot.value?.composeVersion &&
            snapshot.value.binding?.context === snapshot.value.context
          );
        const item = snapshot.value?.containers.find(
          (value) => value.id === (args.containerId ?? selected.value),
        );
        return (
          !!item &&
          (action === "shell" || action === "stop"
            ? item.state === "running"
            : action === "remove" || action === "start"
              ? item.state !== "running"
              : true)
        );
      },
      {
        containerId: "Полный ID; без аргумента используется выбранный контейнер",
        service: "Имя Compose service; без аргумента — всё окружение",
        shell: "sh (по умолчанию) или bash",
        confirm: "true — явное подтверждение удаления",
      },
    );
  }
  register(
    "port.open",
    "Открыть опубликованный порт",
    "Открывает опубликованный TCP-порт в браузере как HTTP или HTTPS. Не определяет протокол приложения автоматически.",
    (args) => {
      const item = snapshot.value?.containers.find(
        (value) => value.id === (args.containerId ?? selected.value),
      );
      const port = item?.ports.find((value) => value.publicPort === args.port && value.url);
      if (
        !port?.url ||
        (args.scheme !== undefined && args.scheme !== "http" && args.scheme !== "https")
      )
        throw new Error("Выберите TCP-порт и http/https");
      openExternalLink(args.scheme === "https" ? port.url.replace(/^http:/, "https:") : port.url);
    },
    ready,
    { containerId: "ID контейнера", port: "Опубликованный порт (число)", scheme: "http или https" },
  );
  async function tick() {
    if (!disposed && !document.hidden && !busy.value)
      try {
        await refresh();
      } catch {
        /* Visible error, retry next tick. */
      }
    if (!disposed) timer = setTimeout(tick, snapshot.value?.enabled ? 5000 : 15000);
  }
  onMounted(() => {
    if (hooks.enabled !== false) void tick();
  });
  onBeforeUnmount(() => {
    disposed = true;
    ++generation;
    clearTimeout(timer);
  });
  const state = {
    snapshot,
    error,
    busy,
    all,
    selected,
    projectContainers,
    containers,
    current,
    commands,
  };
  provide(dockerKey, state);
  return state;
}
export type DockerState = ReturnType<typeof useDocker>;
const dockerKey: InjectionKey<DockerState> = Symbol("docker");
export function useDockerState() {
  const state = inject(dockerKey);
  if (!state) throw new Error("Docker host is not installed");
  return state;
}
