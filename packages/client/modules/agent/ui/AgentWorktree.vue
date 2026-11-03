<script setup lang="ts">
import UiCard from "../../../common/ui/UiCard.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { WorktreeInfo } from "../api/client.ts";
import IconBranch from "~icons/lucide/git-branch";

defineProps<{
  branch: string;
  info?: WorktreeInfo;
  working: boolean;
  /** What the last merge or removal said. */
  note: string;
}>();
const emit = defineEmits<{ merge: []; discard: [] }>();
</script>

<template>
  <UiCard density="compact" class="worktree" aria-label="Изолированная копия проекта">
    <UiInline as="header" align="flex-start" justify="normal">
      <IconBranch aria-hidden="true" />
      <span class="what"
        >Чат работает в изолированной копии, ветка <code>{{ branch }}</code
        >. Файлы проекта не затронуты<template v-if="info"
          >; изменено файлов: {{ info.changed }}</template
        >.</span
      >
    </UiInline>
    <p v-if="note" class="note" role="status">{{ note }}</p>
    <UiInline align="stretch">
      <UiButton
        appearance="solid"
        size="sm"
        :disabled="working"
        title="Влить изменения в ветку проекта и удалить копию"
        @click="emit('merge')"
      >
        Влить в проект
      </UiButton>
      <UiButton
        size="sm"
        :disabled="working"
        title="Удалить копию вместе со всем, что агент в ней сделал"
        @click="emit('discard')"
      >
        Отбросить
      </UiButton>
    </UiInline>
  </UiCard>
</template>

<style scoped>
.worktree {
  margin: 0 0 var(--sp-2);
}
svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}
.what {
  min-width: 0;
  overflow-wrap: anywhere;
  line-height: 1.5;
}
code {
  font-family: var(--mono);
  color: var(--text-2);
}
.note {
  margin: 0;
  color: var(--text-2);
}
</style>
