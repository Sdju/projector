import { computed, onMounted, ref, useId } from "vue";
import {
  isAgentLaunchEnvKey,
  parseAgentLaunchOverride,
  type AgentLaunchOverride,
  type AgentLaunchSettingsView,
  type AgentLaunchState,
} from "@ai-projector/core/modules/agent-launch/index.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { readAgentLaunch, resetAgentLaunch, writeAgentLaunch } from "../api/launch.ts";

/** One argument per line: a line may contain spaces and stays one argv element. */
export function argsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function textFromArgs(args: readonly string[] | undefined): string {
  return (args ?? []).join("\n");
}

/** `KEY=value` per line; `#` starts a comment and an empty line is ignored. */
export function envFromText(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) throw new Error(`Строка ${index + 1}: ожидается KEY=value`);
    const key = line.slice(0, at).trim();
    if (!isAgentLaunchEnvKey(key)) throw new Error(`Строка ${index + 1}: некорректное имя ${key}`);
    if (env[key] !== undefined) throw new Error(`Переменная ${key} указана дважды`);
    env[key] = line.slice(at + 1).trim();
  }
  return env;
}

export function textFromEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env ?? {})
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export interface AgentLaunchDraft {
  command: string;
  args: string;
  env: string;
}

const emptyDraft = (): AgentLaunchDraft => ({ command: "", args: "", env: "" });

/**
 * Machine-local launch settings of one ACP agent. The form edits the override; empty fields mean
 * "use the descriptor", so the file is not pinned to today's defaults by a mere save.
 */
export function useAgentLaunchSettings(agentId: string) {
  const settings = ref<AgentLaunchSettingsView>({ file: "", agents: [] });
  const draft = ref<AgentLaunchDraft>(emptyDraft());
  /** The user cleared or changed args for the current command; do not replace them silently. */
  const argsTouched = ref(false);
  /** The user edited args in this editing session; clearing `command` alone will keep them. */
  const argsEdited = ref(false);
  const busy = ref(false);
  const error = ref("");
  const view = computed<AgentLaunchState | undefined>(() =>
    settings.value.agents.find((agent) => agent.id === agentId),
  );
  const commands = useCommandScope(`agent-launch:${useId()}`, () => ({
    surface: "agentLaunch",
    agent: agentId,
    busy: busy.value,
    overridden: !!view.value?.override,
  }));

  function syncDraft(): void {
    const override = view.value?.override;
    const defaults = view.value?.default.args ?? [];
    argsTouched.value = override?.args !== undefined;
    argsEdited.value = false;
    draft.value = {
      command: override?.command ?? "",
      // A command-only override inherits the agent's base arguments in the resolver; show them.
      args: textFromArgs(override?.args ?? (override?.command ? defaults : [])),
      env: textFromEnv(override?.env),
    };
  }

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка настроек запуска";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  async function reload(): Promise<AgentLaunchSettingsView> {
    settings.value = await readAgentLaunch();
    if (view.value) syncDraft();
    return settings.value;
  }

  function overrideFromDraft(): AgentLaunchOverride {
    const command = draft.value.command.trim();
    const args = argsFromText(draft.value.args);
    const env = envFromText(draft.value.env);
    return {
      ...(command ? { command } : {}),
      // The form pre-fills base arguments; clearing them is an explicit "no arguments".
      ...(command || args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    };
  }

  commands.scope.registerCommand({
    id: "ide.agent.launch.list",
    palette: false,
    title: "Список настроек запуска ACP-агентов",
    description:
      "Возвращает машинные переопределения запуска: агента, значения по умолчанию, сохранённую настройку, итоговую команду и найденный путь.",
    enabled: () => !busy.value,
    run: () => perform(reload),
  });
  commands.scope.registerCommand({
    id: "ide.agent.launch.set",
    title: "Изменить запуск ACP-агента",
    description:
      "Задаёт команду, аргументы и переменные окружения запуска ACP-агента только на этой машине. Без аргументов сохраняет форму; пустые поля возвращают значения агента.",
    arguments: {
      backend: `string: идентификатор агента; по умолчанию ${agentId}`,
      command: "string: исполняемый файл или путь; пусто — из дескриптора",
      args: "string[]: аргументы команды; пусто при своей команде — без аргументов",
      env: "object: переменные окружения KEY=value",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const backend = typeof args.backend === "string" && args.backend ? args.backend : agentId;
      return perform(async () => {
        const hasArgs =
          args.command !== undefined || args.args !== undefined || args.env !== undefined;
        const override = hasArgs
          ? (parseAgentLaunchOverride({
              ...(args.command !== undefined ? { command: args.command } : {}),
              ...(args.args !== undefined ? { args: args.args } : {}),
              ...(args.env !== undefined ? { env: args.env } : {}),
            }) ?? {})
          : overrideFromDraft();
        const next = await writeAgentLaunch(backend, override);
        settings.value = next;
        if (backend === agentId && view.value) syncDraft();
        return next;
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.launch.reset",
    title: "Вернуть запуск ACP-агента по умолчанию",
    description: "Удаляет машинное переопределение команды ACP-агента.",
    arguments: { backend: `string: идентификатор агента; по умолчанию ${agentId}` },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const backend = typeof args.backend === "string" && args.backend ? args.backend : agentId;
      return perform(async () => {
        const next = await resetAgentLaunch(backend);
        settings.value = next;
        if (backend === agentId && view.value) syncDraft();
        return next;
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.launch.check",
    title: "Проверить запуск ACP-агента",
    description: "Перечитывает настройку и проверяет, находится ли итоговая команда.",
    arguments: { backend: `string: идентификатор агента; по умолчанию ${agentId}` },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const backend = typeof args.backend === "string" && args.backend ? args.backend : agentId;
      return perform(async () => {
        const next = await readAgentLaunch();
        settings.value = next;
        return next.agents.find((agent) => agent.id === backend);
      });
    },
  });

  onMounted(() => void perform(reload).catch(() => undefined));

  return { settings, draft, argsTouched, argsEdited, view, busy, error, commands, reload };
}
