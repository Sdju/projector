<script setup lang="ts">
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
  <section class="worktree" aria-label="Изолированная копия проекта">
    <header>
      <IconBranch aria-hidden="true" />
      <span class="what"
        >Чат работает в изолированной копии, ветка <code>{{ branch }}</code
        >. Файлы проекта не затронуты<template v-if="info"
          >; изменено файлов: {{ info.changed }}</template
        >.</span
      >
    </header>
    <p v-if="note" class="note" role="status">{{ note }}</p>
    <div class="actions">
      <UiButton
        variant="solid"
        size="sm"
        :disabled="working"
        title="Влить изменения в ветку проекта и удалить копию"
        @click="emit('merge')"
      >
        Влить в проект
      </UiButton>
      <UiButton
        variant="ghost"
        size="sm"
        :disabled="working"
        title="Удалить копию вместе со всем, что агент в ней сделал"
        @click="emit('discard')"
      >
        Отбросить
      </UiButton>
    </div>
  </section>
</template>

<style scoped>
.worktree {
  display: grid;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
header {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
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
.actions {
  display: flex;
  gap: var(--sp-2);
}
</style>
