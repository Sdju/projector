import { onMounted, ref, useId } from "vue";
import type { AntigravitySkillState } from "@ai-projector/core/modules/agents-integration/antigravity/index.ts";
import { useCommandScope } from "../../../../common/utilities/commands.ts";
import {
  installAntigravitySkill,
  readAntigravitySkill,
  removeAntigravitySkill,
} from "../api/skill.ts";

export function useAntigravitySkill() {
  const state = ref<AntigravitySkillState | null>(null);
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`antigravity-skill:${useId()}`, () => ({
    surface: "antigravitySkill",
    status: state.value?.status ?? "loading",
    busy: busy.value,
  }));

  async function perform(action: () => Promise<AntigravitySkillState>) {
    busy.value = true;
    error.value = "";
    try {
      state.value = await action();
      return state.value;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка навыка Antigravity";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  commands.scope.registerCommand({
    id: "ide.antigravity.skill.status",
    palette: false,
    title: "Состояние навыка Projector для Antigravity",
    description:
      "Возвращает статус установки навыка ~/.gemini/config/skills/projector/SKILL.md (missing, installed, outdated), путь к файлу и его актуальное содержимое.",
    enabled: () => !busy.value,
    run: () => perform(readAntigravitySkill),
  });

  commands.scope.registerCommand({
    id: "ide.antigravity.skill.install",
    title: "Установить или обновить навык Projector для Antigravity",
    description:
      "Записывает актуальный официальный навык ~/.gemini/config/skills/projector/SKILL.md с описанием виджетов, MCP-команд IDE, ролей и навыков Projector.",
    enabled: () => !busy.value,
    run: () => perform(installAntigravitySkill),
  });

  commands.scope.registerCommand({
    id: "ide.antigravity.skill.remove",
    title: "Удалить навык Projector для Antigravity",
    description: "Удаляет установленный файл ~/.gemini/config/skills/projector/SKILL.md.",
    enabled: () => !busy.value && state.value?.status !== "missing",
    run: () => perform(removeAntigravitySkill),
  });

  onMounted(() => void perform(readAntigravitySkill).catch(() => undefined));

  return { state, busy, error, commands };
}
