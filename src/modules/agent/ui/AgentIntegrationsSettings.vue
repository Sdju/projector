<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { ref } from "vue";
import { guiPrograms, programBackend, useAgentModes } from "../model/modes.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";

const { isEnabled, setEnabled, error } = useAgentModes();
const busy = ref("");
const commands = useCommandScope("agentIntegrations:settings", () => ({
  surface: "agentIntegrationsSettings",
  busy: busy.value,
}));
commands.scope.registerCommand({
  id: "ide.agent.integrations.list",
  palette: false,
  title: "Список интеграций агентов",
  description:
    "Возвращает адаптеры агентов (Claude Code, Codex, OpenCode, Cursor, Kimi) с состоянием «включён/выключен».",
  run: () =>
    Object.entries(guiPrograms).map(([program, item]) => ({
      program,
      backend: programBackend(program),
      title: item.title,
      enabled: isEnabled(program),
    })),
});
commands.scope.registerCommand({
  id: "ide.agent.integrations.set",
  title: "Включить или выключить интеграцию агента",
  description:
    "Включает или выключает адаптер агента: claude, codex, opencode, cursor или kimi. Отключённый агент скрывается из меню сессий и статусной строки, а его запуск отклоняется.",
  arguments: {
    program: "string: claude, codex, opencode, cursor или kimi",
    enabled: "boolean: включён ли агент",
  },
  enabled: () => !busy.value,
  run: async (value) => {
    const { program, enabled } = commandArgs(value);
    if (typeof program !== "string" || !guiPrograms[program])
      throw new Error("program: claude, codex, opencode, cursor или kimi");
    if (typeof enabled !== "boolean") throw new Error("enabled должен быть boolean");
    busy.value = program;
    try {
      await setEnabled(program, enabled);
    } finally {
      busy.value = "";
    }
    return { program, enabled: isEnabled(program) };
  },
});
function toggle(program: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  void Promise.resolve(commands.run("ide.agent.integrations.set", { program, enabled })).catch(
    () => {},
  );
}
</script>

<template>
  <UiStack as="section" :gap="4" @pointerdown="commands.scope.activate()">
    <UiField v-for="(program, id) in guiPrograms" :key="id" :label="program.title">
      <UiInline as="label" justify="normal">
        <UiControl
          type="checkbox"
          :checked="isEnabled(id)"
          :disabled="busy === id"
          :aria-label="`Интеграция ${program.title}`"
          @change="toggle(id, $event)"
        />
        включён
      </UiInline>
    </UiField>
    <UiHint>
      Отключённый агент прячется из меню новых сессий, приветствия чата и индикаторов лимитов, а его
      запуск отклоняется сервером. Встроенный агент Projector отключить нельзя.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
