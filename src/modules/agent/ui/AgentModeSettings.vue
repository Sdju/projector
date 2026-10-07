<script setup lang="ts">
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import { guiPrograms, useAgentModes, type AgentSessionMode } from "../model/modes.ts";

const { modeOf, setMode, error } = useAgentModes();
</script>

<template>
  <section class="panel">
    <UiField v-for="(program, id) in guiPrograms" :key="id" :label="program.title">
      <select
        :aria-label="`Режим сессий ${program.title}`"
        :value="modeOf(id)"
        @change="setMode(id, ($event.target as HTMLSelectElement).value as AgentSessionMode)"
      >
        <option value="tui">Терминал (TUI)</option>
        <option value="gui">Графический чат (GUI)</option>
      </select>
    </UiField>
    <UiHint>
      По умолчанию агенты запускаются в терминале. Графический режим — тот же агент с тем же входом
      и настройками, но вывод в чате, а запросы разрешений — кнопками. Режим применяется к новым
      сессиям; переключить его можно и в меню «+».
    </UiHint>
    <p v-if="error" class="err">{{ error }}</p>
  </section>
</template>

<style scoped>
.panel {
  display: grid;
  gap: var(--sp-4);
}
.err {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
</style>
