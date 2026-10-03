<script setup lang="ts">
import { KeybindingsEditor } from "../../ide/index.ts";
import { isEditable, isMarkdown, type OpenFile } from "../open-file.ts";
import {
  ArchiveViewer,
  CodeViewer,
  CommitOverview,
  ImageViewport,
  MarkdownViewer,
  SvgViewer,
} from "../modules/viewers/index.ts";

/** Содержимое одной вкладки файла: хлебные крошки, ошибка сохранения и подходящий просмотрщик. */
defineProps<{ file: OpenFile; projectId: string; revision: number }>();
const emit = defineEmits<{
  change: [draft: string];
  save: [];
  mode: [mode: "document" | "source"];
  open: [path: string];
  openCommit: [hash: string];
  openCommitDiff: [hash: string, path: string];
  subject: [text: string];
}>();
</script>

<template>
  <div class="file-panel">
    <div class="breadcrumb">
      <span>{{ file.path }}</span>
      <span v-if="file.virtual === 'keybindings'">настройки IDE</span>
      <span v-if="file.external">только просмотр</span>
    </div>
    <p v-if="file.saveError && !isMarkdown(file)" class="file-error" role="alert">
      {{ file.saveError }}
    </p>
    <div class="panel-body">
      <KeybindingsEditor v-if="file.virtual === 'keybindings'" />
      <CommitOverview
        v-else-if="file.virtual === 'commit' && file.commit"
        :project-id="projectId"
        :hash="file.commit"
        @open-commit="emit('openCommit', $event)"
        @open-diff="(hash, path) => emit('openCommitDiff', hash, path)"
        @subject="emit('subject', $event)"
      />
      <ImageViewport v-else-if="file.image" :src="file.image" :alt="file.path" />
      <ArchiveViewer v-else-if="file.archive" :archive="file.archive" />
      <SvgViewer
        v-else-if="/\.svg$/i.test(file.path) && file.original === undefined"
        :path="file.path"
        :content="file.draft ?? file.content"
        :editable="isEditable(file)"
        :line="file.line"
        :column="file.column"
        @change="emit('change', $event)"
        @save="emit('save')"
      />
      <MarkdownViewer
        v-else-if="isMarkdown(file)"
        :project-id="projectId"
        :path="file.path"
        :content="file.draft ?? file.content"
        :mode="file.markdownMode ?? 'document'"
        :error="file.saveError"
        :line="file.line"
        :column="file.column"
        @change="emit('change', $event)"
        @mode="emit('mode', $event)"
        @save="emit('save')"
        @open="emit('open', $event)"
      />
      <CodeViewer
        v-else-if="!file.virtual"
        :path="file.path"
        :project-id="projectId"
        :revision="revision"
        :content="file.draft ?? file.content"
        :editable="isEditable(file)"
        :original="file.original"
        :original-label="file.commit ? file.parent || '∅' : file.staged ? 'HEAD' : 'Индекс'"
        :modified-label="
          file.commit ? file.commit.slice(0, 7) : file.staged ? 'Индекс' : 'Рабочий файл'
        "
        :line="file.line"
        :column="file.column"
        @change="emit('change', $event)"
        @save="emit('save')"
      />
    </div>
  </div>
</template>

<style scoped>
.file-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.breadcrumb {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: var(--sp-2) var(--sp-3);
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.breadcrumb span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.breadcrumb span:last-child {
  flex-shrink: 0;
  color: var(--faint);
}
.file-error {
  margin: 0;
  padding: var(--sp-3);
  color: var(--err);
  font-size: var(--fs-xs);
  border-bottom: 1px solid var(--line);
}
.panel-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
@media (max-width: 600px) {
  .breadcrumb span:last-child {
    display: none;
  }
}
</style>
