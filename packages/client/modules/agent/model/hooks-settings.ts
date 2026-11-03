import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentHooks, writeAgentHooks, type AgentHooks } from "../api/hooks.ts";

/** Hooks of the Projector agent: commands the user runs before and after tools and at the end of an answer. */
export function useAgentHooksSettings() {
  const hooks = ref<AgentHooks>({ text: "", hooks: [] });
  const draft = ref<string>();
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-hooks:${useId()}`, () => ({
    surface: "agentHooks",
    busy: busy.value,
    hooks: hooks.value.hooks.length,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка хуков агента";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  async function reload(): Promise<AgentHooks> {
    hooks.value = await readAgentHooks();
    draft.value = undefined;
    return hooks.value;
  }

  commands.scope.registerCommand({
    id: "ide.agent.hooks.get",
    title: "Прочитать хуки агента",
    description:
      "Возвращает хуки штатного агента Projector: файл пользователя (text) и действующие хуки (событие PreToolUse, PostToolUse или Stop, источник user или project, команда, matcher).",
    enabled: () => !busy.value,
    run: () => perform(reload),
  });
  commands.scope.registerCommand({
    id: "ide.agent.hooks.set",
    title: "Записать хуки агента",
    description:
      'Заменяет файл хуков пользователя целиком. text — JSON вида { "hooks": { "Stop": [{ "command": "notify-send Готово", "minSeconds": 30 }], "PreToolUse": [{ "matcher": "^run_command$", "command": "./check.sh" }] } }. Код выхода 2 у PreToolUse запрещает вызов; хук может ответить JSON { "decision": "block", "reason": "…" } или { "additionalContext": "…" }. Пустая строка удаляет файл. Без аргументов сохраняет текст с экрана.',
    arguments: { text: "Новый JSON хуков; пустая строка — удалить" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const text = typeof args.text === "string" ? args.text : (draft.value ?? hooks.value.text);
      return perform(async () => {
        await writeAgentHooks(text);
        return reload();
      });
    },
  });
  onMounted(() => void perform(reload).catch(() => undefined));

  return { hooks, draft, busy, error, commands };
}
