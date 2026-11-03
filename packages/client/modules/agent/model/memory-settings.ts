import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentMemory, writeAgentMemory, type AgentMemory } from "../api/memory.ts";

/** Notes the Projector agent carries into every answer: general ones and one set per project. */
export function useAgentMemorySettings() {
  const memory = ref<AgentMemory>({ user: "", projects: [] });
  /** Unsaved text by key: `user` or the project path. */
  const drafts = ref<Record<string, string>>({});
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-memory:${useId()}`, () => ({
    surface: "agentMemory",
    busy: busy.value,
    projects: memory.value.projects.length,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка заметок агента";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  async function reload(): Promise<AgentMemory> {
    memory.value = await readAgentMemory();
    drafts.value = {};
    return memory.value;
  }

  const textOf = (key: string) =>
    drafts.value[key] ??
    (key === "user"
      ? memory.value.user
      : memory.value.projects.find((p) => p.path === key)?.text) ??
    "";

  commands.scope.registerCommand({
    id: "ide.agent.memory.get",
    title: "Прочитать заметки агента",
    description:
      "Возвращает заметки штатного агента Projector: общие (user) и по проектам (путь и текст).",
    enabled: () => !busy.value,
    run: () => perform(reload),
  });
  commands.scope.registerCommand({
    id: "ide.agent.memory.set",
    title: "Записать заметки агента",
    description:
      "Заменяет заметки штатного агента целиком. Без path — общие заметки, с path — заметки проекта по его пути; пустой text удаляет их. Лимит 6000 знаков. Без аргументов сохраняет общие заметки с экрана.",
    arguments: {
      text: "Новый текст заметок; пустая строка — удалить",
      path: "Путь проекта; без него — общие заметки",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const path = typeof args.path === "string" && args.path ? args.path : undefined;
      const text = typeof args.text === "string" ? args.text : textOf(path ?? "user");
      return perform(async () => {
        await writeAgentMemory(text, path);
        return reload();
      });
    },
  });
  onMounted(() => void perform(reload).catch(() => undefined));

  return { memory, drafts, textOf, busy, error, commands };
}
