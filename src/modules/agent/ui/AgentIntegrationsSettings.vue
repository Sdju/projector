<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { ref } from "vue";
import { guiAgents, hasGui, useAgentModes } from "../model/modes.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";

const { isEnabled, setEnabled, error } = useAgentModes();
const busy = ref("");
const programs = () => guiAgents().map((agent) => agent.program);
const titles = () => guiAgents().map((agent) => agent.title);
const commands = useCommandScope("agentIntegrations:settings", () => ({
  surface: "agentIntegrationsSettings",
  busy: busy.value,
}));
commands.scope.registerCommand({
  id: "ide.agent.integrations.list",
  palette: false,
  title: "Список интеграций агентов",
  description: `Возвращает адаптеры агентов (${titles().join(", ")}) с состоянием «включён/выключен».`,
  run: () =>
    guiAgents().map((agent) => ({
      program: agent.program,
      backend: agent.backend,
      title: agent.title,
      enabled: isEnabled(agent.program),
    })),
});
commands.scope.registerCommand({
  id: "ide.agent.integrations.set",
  title: "Включить или выключить интеграцию агента",
  description: `Включает или выключает адаптер агента: ${programs().join(", ")}. Отключённый агент скрывается из меню сессий и статусной строки, а его запуск отклоняется.`,
  arguments: {
    program: `string: ${programs().join(", ")}`,
    enabled: "boolean: включён ли агент",
  },
  enabled: () => !busy.value,
  run: async (value) => {
    const { program, enabled } = commandArgs(value);
    if (typeof program !== "string" || !hasGui(program))
      throw new Error(`program: ${programs().join(", ")}`);
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
    <UiField v-for="agent in guiAgents()" :key="agent.program" :label="agent.title">
      <UiInline as="label" justify="normal">
        <UiControl
          type="checkbox"
          :checked="isEnabled(agent.program)"
          :disabled="busy === agent.program"
          :aria-label="`Интеграция ${agent.title}`"
          @change="toggle(agent.program, $event)"
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
