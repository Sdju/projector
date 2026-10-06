<script setup lang="ts">
import UiHint from "../../../../common/ui/UiHint.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const { draft, project, busy } = useProjectSettingsForm();
</script>

<template>
  <fieldset class="section" :disabled="busy">
    <label class="field">Название<input v-model="draft.name" required autocomplete="off" /></label>
    <div class="field">
      Папка проекта<code class="project-root">{{ project().path }}</code>
    </div>
    <label class="field"
      >Путь к иконке<input v-model="draft.icon" placeholder="Автоматически" spellcheck="false"
    /></label>
    <UiHint
      >Файл внутри проекта, например public/icon.svg. Пустое поле — автоматический выбор.</UiHint
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
  min-width: 0;
  color: var(--muted);
}
.project-root {
  color: var(--muted);
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  user-select: all;
}
</style>
