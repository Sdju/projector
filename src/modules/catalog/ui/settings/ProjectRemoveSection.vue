<script setup lang="ts">
import UiHint from "../../../../common/ui/UiHint.vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const form = useProjectSettingsForm();
</script>

<template>
  <div class="remove">
    <UiHint>Файлы останутся на диске. Терминалы и процессы проекта будут завершены.</UiHint>
    <UiButton variant="danger" :disabled="form.busy.value" @click="form.remove"
      >Убрать проект</UiButton
    >
  </div>
</template>

<style scoped>
.remove {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
</style>
