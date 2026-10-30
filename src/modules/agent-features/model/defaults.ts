import { computed, onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { writeAgentFeature } from "../api/features.ts";
import { applyAgentFeatures, useAgentFeatureCatalog } from "./catalog.ts";

/** Defaults of the feature matrix: what an agent gets in a chat that has no choice of its own. */
export function useAgentFeatureDefaults() {
  const { data, error: loadError, load } = useAgentFeatureCatalog();
  const busy = ref("");
  const error = ref("");
  const message = computed(() => error.value || loadError.value);
  const commands = useCommandScope(`agent-feature-defaults:${useId()}`, () => ({
    surface: "agentFeatureDefaults",
    busy: !!busy.value,
    features: data.value.features.length,
  }));

  async function reload() {
    error.value = "";
    try {
      return await load(true);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Ошибка возможностей агентов";
      throw cause;
    }
  }

  async function set(feature: string, agent: string, enabled: boolean) {
    busy.value = `${feature}:${agent}`;
    error.value = "";
    try {
      applyAgentFeatures(await writeAgentFeature(feature, agent, enabled));
      return data.value;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : "Не удалось сохранить умолчание";
      throw cause;
    } finally {
      busy.value = "";
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.features.defaults.list",
    palette: false,
    title: "Список умолчаний возможностей агентов",
    description:
      "Возвращает возможности чата (например виджеты в ответах) и для каждой агента (Projector, Claude Code, Codex, OpenCode, Cursor, Kimi) с умолчанием: включена ли она в новом чате. Это значения, которые чат может переопределить для себя; сам остров в табе агента меняет только текущий чат.",
    run: () => reload(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.features.defaults.set",
    palette: false,
    title: "Изменить умолчание возможности агента",
    description:
      "Включает или выключает возможность (widgets — виджеты в ответах) для агента по умолчанию. Действует на новые чаты без своего переопределения; уже открытый чат меняет остров в табе агента. Отключение виджетов у Projector убирает их из его системного промпта по умолчанию.",
    arguments: {
      feature: "string: id возможности, например widgets",
      agent: "string: projector, claude-code, codex, opencode, cursor или kimi",
      enabled: "boolean: включена ли возможность по умолчанию",
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
  onMounted(() => void reload().catch(() => undefined));

  return { data, busy, error: message, load: reload, set, commands };
}
