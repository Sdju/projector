<script setup lang="ts">
import UiInline from "../../../../common/ui/UiInline.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";

const form = useProjectSettingsForm();
</script>

<template>
  <UiInline class="remove" justify="between" wrap :gap="3">
    <UiHint>Файлы останутся на диске. Терминалы и процессы проекта будут завершены.</UiHint>
    <UiButton tone="danger" :disabled="form.busy.value" @click="form.remove"
      >Убрать проект</UiButton
    >
  </UiInline>
</template>
