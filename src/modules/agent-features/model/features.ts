import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentFeatures, writeAgentFeature, type AgentFeatures } from "../api/features.ts";

/**
 * Which optional abilities each chat agent has. The server decides how a feature reaches an agent;
 * the island only reads and writes the choice.
 */
export function useAgentFeatures() {
  const data = ref<AgentFeatures>({ features: [], file: "" });
  const busy = ref("");
  const error = ref("");
  const commands = useCommandScope(`agent-features:${useId()}`, () => ({
    surface: "agentFeatures",
    busy: !!busy.value,
    features: data.value.features.length,
  }));

  async function load(): Promise<AgentFeatures> {
    error.value = "";
    try {
      data.value = await readAgentFeatures();
      return data.value;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка возможностей агентов";
      throw err;
    }
  }

  async function set(feature: string, agent: string, enabled: boolean): Promise<AgentFeatures> {
    const previous = data.value;
    // Paint the checkbox at once; the server answers with the whole matrix or the change reverts.
    data.value = {
      ...previous,
      features: previous.features.map((item) =>
        item.id !== feature
          ? item
          : {
              ...item,
              agents: item.agents.map((target) =>
                target.id === agent ? { ...target, enabled } : target,
              ),
            },
      ),
    };
    busy.value = agent;
    error.value = "";
    try {
      data.value = await writeAgentFeature(feature, agent, enabled);
      return data.value;
    } catch (err) {
      data.value = previous;
      error.value = err instanceof Error ? err.message : "Не удалось сохранить возможность";
      throw err;
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.features.list",
    palette: false,
    title: "Список возможностей агентов",
    description:
      "Возвращает необязательные возможности чата (например виджеты в ответах) и для каждой — агентов (Projector, Claude Code, Codex, OpenCode, Cursor, Kimi) с пометкой, включена ли она. Возможность доставляется агенту в промпте: у Projector — в системном, у остальных — в первом сообщении новой сессии.",
    run: () => load(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.features.set",
    title: "Включить или выключить возможность агента",
    description:
      "Включает или выключает необязательную возможность (widgets — виджеты в ответах) для одного агента. Действует со следующего сообщения: Projector и Claude Code получают её сразу, ACP-агенты (Codex, OpenCode, Cursor, Kimi) — в новой сессии. Отключение виджетов у Projector убирает их из его системного промпта.",
    arguments: {
      feature: "string: id возможности, например widgets",
      agent: "string: projector, claude-code, codex, opencode, cursor или kimi",
      enabled: "boolean: включена ли возможность",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.feature !== "string" || !args.feature)
        throw new Error("feature: id возможности, например widgets");
      if (typeof args.agent !== "string" || !args.agent)
        throw new Error("agent: projector, claude-code, codex, opencode, cursor или kimi");
      if (typeof args.enabled !== "boolean") throw new Error("enabled должен быть boolean");
      return set(args.feature, args.agent, args.enabled);
    },
  });
  onMounted(() => void load().catch(() => undefined));

  return { data, busy, error, load, set, commands };
}
