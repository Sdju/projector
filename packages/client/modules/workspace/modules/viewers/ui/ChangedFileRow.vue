<script setup lang="ts">
import CommitFileDiff from "./CommitFileDiff.vue";
import { FileIcon } from "../../../../file-icons/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import type { ChangedFileDiff, ChangedFileItem } from "../lib/changed-files.ts";
import { computed } from "vue";
import IconChevronRight from "~icons/lucide/chevron-right";
import IconOpen from "~icons/lucide/external-link";

/** One changed file with its expandable diff; the list owner keeps expansion and cache state. */
const props = defineProps<{
  file: ChangedFileItem;
  expanded: boolean;
  diff?: ChangedFileDiff;
  height?: number;
  toggleCommand?: string;
  openCommand?: string;
  /** Host shown in the "too large" note. */
  host?: string;
}>();
const emit = defineEmits<{ toggle: [open?: boolean]; open: []; resize: [height: number] }>();
const note = computed(() => {
  const data = props.diff?.data;
  if (!data) return "";
  if (data.tooLarge)
    return `Файл слишком большой для diff. Откройте его на ${props.host ?? "хостинге"}.`;
  if (data.binary) return "Бинарный файл: diff не показывается.";
  return "";
});
</script>

<template>
  <li>
    <div class="file-row">
      <button
        type="button"
        class="file"
        :disabled="!file.expandable"
        :aria-expanded="file.expandable ? expanded : undefined"
        :title="file.disabledTitle"
        :data-command="toggleCommand"
        @click="emit('toggle')"
      >
        <span class="glyph" aria-hidden="true">
          <IconChevronRight v-if="file.expandable" :class="{ open: expanded }" />
        </span>
        <b class="status" :class="file.mark">{{ file.mark }}</b>
        <FileIcon :icon="file.icon" />
        <span class="name">{{ file.name }}</span>
        <span class="dir u-truncate">
          <template v-if="file.previousPath">{{ file.previousPath }} → </template
          >{{ file.directory }}
        </span>
        <span v-if="file.binary" class="muted">бинарный</span>
        <span v-else-if="file.tooLarge" class="muted">большой</span>
        <span v-else-if="file.generated" class="muted">сгенерирован</span>
        <template v-else>
          <span v-if="file.additions + file.deletions" class="bar" aria-hidden="true">
            <i :style="{ width: `${file.share * 100}%` }" />
          </span>
          <span class="add">+{{ file.additions }}</span>
          <span class="del">−{{ file.deletions }}</span>
        </template>
      </button>
      <UiButton
        v-if="file.openable"
        shape="icon"
        size="sm"
        title="Открыть изменения во вкладке"
        :aria-label="`Открыть изменения во вкладке: ${file.path}`"
        :data-command="openCommand"
        @click="emit('open')"
      >
        <IconOpen aria-hidden="true" />
      </UiButton>
    </div>
    <div v-if="expanded" class="inline">
      <UiHint v-if="diff?.loading" size="xs" leading="inherit" class="note" role="status"
        >загрузка…</UiHint
      >
      <UiHint v-else-if="diff?.error" size="xs" leading="inherit" class="note error" role="alert">
        {{ diff.error }}
      </UiHint>
      <UiHint v-else-if="note" size="xs" leading="inherit" class="note">{{ note }}</UiHint>
      <CommitFileDiff
        v-else-if="diff?.data"
        :comparison="diff.data"
        :path="file.path"
        :height="height"
        @resize="emit('resize', $event)"
        @collapse="emit('toggle', false)"
      />
    </div>
  </li>
</template>

<style scoped>
.file-row {
  display: flex;
  align-items: center;
  padding-right: var(--sp-2);
}
.file-row:hover {
  background: var(--hover);
}
.file {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
}
.file:disabled {
  cursor: default;
  opacity: 0.7;
}
.glyph {
  width: 12px;
  flex-shrink: 0;
  color: var(--faint);
}
.glyph svg {
  width: 12px;
  height: 12px;
  display: block;
}
.glyph svg.open {
  transform: rotate(90deg);
}
.muted {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.status {
  width: 14px;
  font: var(--fs-2xs) var(--mono);
  color: var(--run);
}
.status.D {
  color: var(--err);
}
.status.R,
.status.C {
  color: var(--accent);
}
.name {
  flex-shrink: 0;
}
.dir {
  flex: 1;
  min-width: 0;
  direction: rtl;
  text-align: left;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.bar {
  width: 48px;
  height: 4px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--err);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--run);
}
.add,
.del {
  flex-shrink: 0;
  font: var(--fs-2xs) var(--mono);
}
.add {
  color: var(--run);
}
.del {
  color: var(--err);
}
.inline {
  border-top: 1px solid var(--line);
}
.inline .note {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
}
.note.error {
  color: var(--err);
}
</style>
