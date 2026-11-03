import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentMcp, writeAgentMcp, type AgentMcp } from "../api/mcp.ts";

/** MCP servers the Projector agent connects to for each answer: the user's own list. */
export function useAgentMcpSettings() {
  const mcp = ref<AgentMcp>({ text: "", servers: [] });
  const draft = ref<string>();
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-mcp:${useId()}`, () => ({
    surface: "agentMcp",
    busy: busy.value,
    servers: mcp.value.servers.length,
  }));

  async function perform<T>(action: () => Promise<T>): Promise<T> {
    busy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка MCP-серверов агента";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  async function reload(): Promise<AgentMcp> {
    mcp.value = await readAgentMcp();
    draft.value = undefined;
    return mcp.value;
  }

  commands.scope.registerCommand({
    id: "ide.agent.mcp.get",
    title: "Прочитать MCP-серверы агента",
    description:
      "Возвращает список MCP-серверов штатного агента Projector: свой файл пользователя (text) и серверы, которые он подключает (имя, источник user или project, тип stdio, http или sse).",
    enabled: () => !busy.value,
    run: () => perform(reload),
  });
  commands.scope.registerCommand({
    id: "ide.agent.mcp.set",
    title: "Записать MCP-серверы агента",
    description:
      'Заменяет файл MCP-серверов пользователя целиком. text — JSON вида { "mcpServers": { "имя": { "command": "npx", "args": ["…"], "env": {} } } } или { "type": "http", "url": "…", "headers": {} }; пустая строка удаляет файл. Серверы из .mcp.json проекта подключаются сами, но с вопросом. Без аргументов сохраняет текст с экрана.',
    arguments: { text: "Новый JSON списка серверов; пустая строка — удалить" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      const text = typeof args.text === "string" ? args.text : (draft.value ?? mcp.value.text);
      return perform(async () => {
        await writeAgentMcp(text);
        return reload();
      });
    },
  });
  onMounted(() => void perform(reload).catch(() => undefined));

  return { mcp, draft, busy, error, commands };
}
