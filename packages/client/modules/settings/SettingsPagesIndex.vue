<script setup lang="ts">
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import type { SettingsItem } from "./sections.ts";

defineProps<{ pages: SettingsItem[] }>();
const emit = defineEmits<{ open: [id: string] }>();
</script>

<template>
  <div class="pages-index">
    <UiHint>У раздела несколько страниц: выберите слева или откройте одну из кнопок.</UiHint>
    <UiInline wrap :gap="2">
      <UiButton
        v-for="page in pages"
        :key="page.id"
        :title="page.description"
        @click="emit('open', page.id)"
        >{{ page.title }}</UiButton
      >
    </UiInline>
  </div>
</template>

<style scoped>
.pages-index {
  display: grid;
  gap: var(--sp-4);
}
</style>
