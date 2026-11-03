<script setup lang="ts">
import UiControl from "../../../../common/ui/UiControl.vue";
import UiStack from "../../../../common/ui/UiStack.vue";
import UiField from "../../../../common/ui/UiField.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const { draft, project, busy } = useProjectSettingsForm();
</script>

<template>
  <UiStack as="fieldset" :disabled="busy">
    <UiField v-slot="{ control }" layout="plain" label="Название" required>
      <UiControl v-bind="control" v-model="draft.name" autocomplete="off" />
    </UiField>
    <UiField layout="plain" as="div" label="Папка проекта">
      <code class="project-root">{{ project().path }}</code>
    </UiField>
    <UiField v-slot="{ control }" layout="plain" label="Путь к иконке">
      <UiControl
        v-bind="control"
        v-model="draft.icon"
        placeholder="Автоматически"
        spellcheck="false"
      />
    </UiField>
    <UiHint
      >Файл внутри проекта, например public/icon.svg. Пустое поле — автоматический выбор.</UiHint
    >
  </UiStack>
</template>

<style scoped>
.project-root {
  color: var(--muted);
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  user-select: all;
}
</style>
