<script setup lang="ts">
import UiInline from "../../../../common/ui/UiInline.vue";
import UiControl from "../../../../common/ui/UiControl.vue";
import UiStack from "../../../../common/ui/UiStack.vue";
import UiField from "../../../../common/ui/UiField.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const { draft, busy } = useProjectSettingsForm();
</script>

<template>
  <UiStack as="fieldset" :disabled="busy">
    <UiField v-slot="{ control }" layout="plain" label="Команда по умолчанию">
      <UiControl as="select" v-bind="control" v-model="draft.defaultCommandId">
        <option v-for="(command, index) in draft.commands" :key="command.id" :value="command.id">
          {{ command.name || `Команда ${index + 1}` }}
        </option>
      </UiControl>
    </UiField>
    <UiHint>Используется при запуске проекта из палитры, списка проектов и кнопки запуска.</UiHint>
    <UiField v-slot="{ control }" layout="plain" label="Адрес приложения">
      <UiControl
        v-bind="control"
        v-model="draft.url"
        type="url"
        placeholder="Необязательно, например http://localhost:5173"
        spellcheck="false"
    /></UiField>
    <UiInline as="label" class="checkbox" align="start" justify="normal"
      ><UiControl
        :checked="draft.mode === 'window'"
        type="checkbox"
        @change="draft.mode = ($event.target as HTMLInputElement).checked ? 'window' : 'server'"
      />Открывать приложение в отдельном окне после запуска</UiInline
    >
    <UiHint
      >Без автоматического открытия команда работает в терминале. Изменения применятся при следующем
      запуске.</UiHint
    >
  </UiStack>
</template>

<style scoped>
.checkbox {
  color: var(--muted);
}
.checkbox input {
  margin: var(--sp-1) 0 0;
  flex-shrink: 0;
}
</style>
