<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiStack from "../../../common/ui/UiStack.vue";

import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { guiPrograms, useAgentModes, type AgentSessionMode } from "../model/modes.ts";

const { modeOf, setMode, error } = useAgentModes();
</script>

<template>
  <UiStack as="section" :gap="4">
    <UiField
      v-slot="{ control }"
      v-for="(program, id) in guiPrograms"
      :key="id"
      :label="program.title"
    >
      <UiControl
        as="select"
        v-bind="control"
        :aria-label="`Режим сессий ${program.title}`"
        :value="modeOf(id)"
        @change="setMode(id, ($event.target as HTMLSelectElement).value as AgentSessionMode)"
      >
        <option value="tui">Терминал (TUI)</option>
        <option value="gui">Графический чат (GUI)</option>
      </UiControl>
    </UiField>
    <UiHint>
      По умолчанию агенты запускаются в терминале. Графический режим — тот же агент с тем же входом
      и настройками, но вывод в чате, а запросы разрешений — кнопками. Режим применяется к новым
      сессиям; переключить его можно и в меню «+».
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
