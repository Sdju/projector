<script setup lang="ts">
import UiHint from "../../../../common/ui/UiHint.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const { draft, busy } = useProjectSettingsForm();
</script>

<template>
  <fieldset class="section" :disabled="busy">
    <label class="field"
      >Команда по умолчанию
      <select v-model="draft.defaultCommandId">
        <option v-for="(command, index) in draft.commands" :key="command.id" :value="command.id">
          {{ command.name || `Команда ${index + 1}` }}
        </option>
      </select>
    </label>
    <UiHint>Используется при запуске проекта из палитры, списка проектов и кнопки запуска.</UiHint>
    <label class="field"
      >Адрес приложения<input
        v-model="draft.url"
        type="url"
        placeholder="Необязательно, например http://localhost:5173"
        spellcheck="false"
    /></label>
    <label class="checkbox"
      ><input
        :checked="draft.mode === 'window'"
        type="checkbox"
        @change="draft.mode = ($event.target as HTMLInputElement).checked ? 'window' : 'server'"
      />Открывать приложение в отдельном окне после запуска</label
    >
    <UiHint
      >Без автоматического открытия команда работает в терминале. Изменения применятся при следующем
      запуске.</UiHint
    >
  </fieldset>
</template>

<style scoped>
.section {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.field {
  display: grid;
  gap: var(--sp-2);
  color: var(--muted);
}
.checkbox {
  display: flex;
  align-items: start;
  gap: var(--sp-2);
  color: var(--muted);
}
.checkbox input {
  width: auto;
  margin: var(--sp-1) 0 0;
  flex-shrink: 0;
}
</style>
