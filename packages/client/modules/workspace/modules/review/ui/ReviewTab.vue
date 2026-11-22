<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiControl, { type UiControlHandle } from "../../../../../common/ui/UiControl.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import { computed, inject, nextTick, ref } from "vue";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { FileIcon, useFileIconTheme } from "../../../../file-icons/index.ts";
import {
  formatCommentCount,
  formatFileCount,
  formatLineLabel,
  formatLineRange,
} from "../lib/review-message.ts";
import { reviewSessionKey, type ReviewComment } from "../lib/review-session.ts";

const props = defineProps<{
  projectId: string;
  run: (id: string, args?: unknown) => unknown;
}>();
const review = inject(reviewSessionKey);
if (!review) throw new Error("Review session is not provided");

const { resolver } = useFileIconTheme();
const editingId = ref<string>();
const editDraft = ref("");
const editError = ref("");
const editInput = ref<UiControlHandle[] | UiControlHandle>();

const groups = computed(() => {
  const byKey = new Map<string, { path: string; staged: boolean; rows: ReviewComment[] }>();
  for (const comment of review.comments.value) {
    const staged = comment.staged === true;
    const key = `${comment.path}:${staged ? "staged" : "working"}`;
    let group = byKey.get(key);
    if (!group) {
      group = { path: comment.path, staged, rows: [] };
      byKey.set(key, group);
    }
    group.rows.push(comment);
  }
  return [...byKey.entries()].map(([key, group]) => {
    const parts = group.path.split("/");
    const name = parts.at(-1)!;
    const directory = parts.slice(0, -1).join("/");
    const rows = [...group.rows].sort((a, b) => a.from - b.from || a.createdAt - b.createdAt);
    return {
      key,
      path: group.path,
      name,
      directory,
      staged: group.staged,
      icon: resolver.value.resolve({ name, path: group.path, directory: false }, false),
      rows,
    };
  });
});

const totalCount = computed(() => review.comments.value.length);
const fileCount = computed(() => new Set(review.comments.value.map((item) => item.path)).size);

function snippetLines(comment: ReviewComment) {
  if (!comment.snippet) return [];
  return comment.snippet.split("\n").map((line, index) => ({
    number: comment.from + index,
    text: line,
  }));
}

async function startEdit(comment: ReviewComment) {
  editingId.value = comment.id;
  editDraft.value = comment.text;
  editError.value = "";
  await nextTick();
  const handle = Array.isArray(editInput.value) ? editInput.value[0] : editInput.value;
  handle?.focus();
}

function cancelEdit() {
  editingId.value = undefined;
  editDraft.value = "";
  editError.value = "";
}

async function saveEdit(id: string) {
  const value = editDraft.value.trim();
  if (!value) return;
  try {
    await props.run("ide.review.comment.update", { id, text: value });
    cancelEdit();
  } catch (err) {
    editError.value = err instanceof Error ? err.message : "Не удалось сохранить замечание";
  }
}

function onEditKeydown(event: KeyboardEvent, id: string) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelEdit();
  } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    void saveEdit(id);
  }
}

useTabReadout(() => {
  const comments = review.comments.value;
  const lines = comments.map(
    (comment) => `${comment.path}:${formatLineRange(comment.from, comment.to)}\n${comment.text}`,
  );
  return {
    note: "Ревью изменений",
    text: readoutLines(
      comments.length ? `Замечания (${comments.length}):\n${lines.join("\n\n")}` : "Замечаний нет",
    ),
  };
});
</script>

<template>
  <UiViewerPage class="review-tab">
    <UiArticle :width="760">
      <header class="review-head">
        <div class="summary">
          <template v-if="totalCount">
            <span class="summary-main">{{ formatCommentCount(totalCount) }}</span>
            <span class="summary-sep" aria-hidden="true">·</span>
            <span class="summary-sub">{{ formatFileCount(fileCount) }}</span>
            <span v-if="review.sentAt.value" class="sent-badge">
              <ProjectorIcon name="check" aria-hidden="true" />
              в чате
            </span>
          </template>
          <span v-else class="summary-sub">Нет замечаний</span>
        </div>
        <div v-if="totalCount" class="actions">
          <UiButton
            size="sm"
            appearance="quiet"
            tone="muted"
            title="Удалить все замечания"
            data-command="ide.review.clear"
            @click="run('ide.review.clear')"
          >
            Очистить
          </UiButton>
          <UiButton
            size="sm"
            appearance="solid"
            title="Положить замечания в черновик чата агента"
            data-command="ide.review.toChat"
            @click="run('ide.review.toChat')"
          >
            <ProjectorIcon name="message-square-share" class="btn-icon" aria-hidden="true" />
            В чат
          </UiButton>
        </div>
      </header>

      <div v-if="!totalCount" class="empty">
        <ProjectorIcon name="message-square-plus" class="empty-icon" aria-hidden="true" />
        <p class="empty-title">Замечаний пока нет</p>
        <p class="empty-hint">
          Откройте diff в панели Git — нажмите «+» рядом с номером строки или выделите фрагмент
          кода.
        </p>
      </div>

      <div v-else class="groups">
        <section v-for="group in groups" :key="group.key" class="file-group">
          <div class="file-head">
            <button
              type="button"
              class="file-open"
              :title="`Открыть ${group.path}`"
              data-command="ide.review.comment.open"
              @click="run('ide.review.comment.open', { id: group.rows[0]!.id })"
            >
              <FileIcon :icon="group.icon" />
              <span class="file-name">{{ group.name }}</span>
              <span v-if="group.directory" class="file-dir u-truncate">{{ group.directory }}</span>
              <span v-if="group.staged" class="side-badge">Staged</span>
            </button>
            <span class="file-count">{{ group.rows.length }}</span>
          </div>
          <ul class="remarks">
            <li v-for="comment in group.rows" :key="comment.id" class="remark">
              <div class="remark-head">
                <button
                  type="button"
                  class="line-jump"
                  :title="`Перейти к ${group.path}:${formatLineRange(comment.from, comment.to)}`"
                  data-command="ide.review.comment.open"
                  @click="run('ide.review.comment.open', { id: comment.id })"
                >
                  <span class="line-badge">{{ formatLineLabel(comment.from, comment.to) }}</span>
                  <ProjectorIcon name="corner-down-right" class="jump-icon" aria-hidden="true" />
                </button>
                <div class="remark-actions">
                  <UiButton
                    v-if="editingId !== comment.id"
                    shape="icon"
                    size="sm"
                    title="Изменить замечание"
                    aria-label="Изменить замечание"
                    data-command="ide.review.comment.update"
                    @click="startEdit(comment)"
                  >
                    <ProjectorIcon name="pencil" aria-hidden="true" />
                  </UiButton>
                  <UiButton
                    shape="icon"
                    size="sm"
                    tone="danger"
                    title="Удалить замечание"
                    aria-label="Удалить замечание"
                    data-command="ide.review.comment.remove"
                    @click="run('ide.review.comment.remove', { id: comment.id })"
                  >
                    <ProjectorIcon name="trash-2" aria-hidden="true" />
                  </UiButton>
                </div>
              </div>

              <button
                v-if="comment.snippet"
                type="button"
                class="snippet"
                :title="`Перейти к ${group.path}:${formatLineRange(comment.from, comment.to)}`"
                data-command="ide.review.comment.open"
                @click="run('ide.review.comment.open', { id: comment.id })"
              >
                <span v-for="line in snippetLines(comment)" :key="line.number" class="snippet-row">
                  <span class="snippet-no">{{ line.number }}</span>
                  <span class="snippet-code">{{ line.text || " " }}</span>
                </span>
              </button>

              <form
                v-if="editingId === comment.id"
                class="edit-form"
                @submit.prevent="saveEdit(comment.id)"
              >
                <UiControl
                  ref="editInput"
                  as="textarea"
                  v-model="editDraft"
                  :rows="3"
                  aria-label="Текст замечания"
                  @keydown="onEditKeydown($event, comment.id)"
                />
                <p v-if="editError" class="edit-error" role="alert">{{ editError }}</p>
                <div class="edit-actions">
                  <UiButton size="sm" @click="cancelEdit">Отмена</UiButton>
                  <UiButton
                    type="submit"
                    size="sm"
                    appearance="solid"
                    :disabled="!editDraft.trim()"
                  >
                    Сохранить
                  </UiButton>
                </div>
              </form>
              <p v-else class="remark-text">{{ comment.text }}</p>
            </li>
          </ul>
        </section>
      </div>
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.review-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-2);
  padding-bottom: var(--sp-3);
  margin-bottom: var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.summary {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-sm);
}
.summary-main {
  font-weight: 500;
  color: var(--text);
}
.summary-sep,
.summary-sub {
  color: var(--muted);
}
.sent-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: var(--sp-1);
  padding: 1px 7px;
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--run) 14%, transparent);
  color: var(--run);
  font-size: var(--fs-2xs);
}
.sent-badge svg {
  width: 11px;
  height: 11px;
}
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.btn-icon {
  width: 13px;
  height: 13px;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: var(--sp-6) var(--sp-4);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
}
.empty-icon {
  width: 22px;
  height: 22px;
  color: var(--faint);
  margin-bottom: 2px;
}
.empty-title {
  margin: 0;
  font-size: var(--fs-sm);
  color: var(--text-2);
}
.empty-hint {
  margin: 0;
  max-width: 420px;
  font-size: var(--fs-xs);
  line-height: var(--lh);
  color: var(--muted);
}
.groups {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.file-group {
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  overflow: hidden;
}
.file-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding-right: var(--sp-3);
  background: var(--bg-3);
}
.file-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
}
.file-open:hover {
  background: var(--hover);
}
.file-name {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--text);
}
.file-dir {
  flex: 1;
  min-width: 0;
  direction: rtl;
  text-align: left;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.side-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--info) 16%, transparent);
  color: var(--info);
  font: var(--fs-2xs) var(--mono);
}
.file-count {
  flex-shrink: 0;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.remarks {
  list-style: none;
  margin: 0;
  padding: 0;
}
.remark {
  padding: 10px var(--sp-3) var(--sp-3);
  border-top: 1px solid var(--line);
}
.remark-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
  margin-bottom: 6px;
}
.line-jump {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px;
  margin-left: -6px;
  border-radius: var(--r-sm);
  color: var(--muted);
}
.line-jump:hover {
  background: var(--hover);
  color: var(--text);
}
.line-badge {
  font: var(--fs-2xs) var(--mono);
  color: var(--accent);
}
.jump-icon {
  width: 12px;
  height: 12px;
  opacity: 0.55;
}
.line-jump:hover .jump-icon {
  opacity: 1;
}
.remark-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.remark-actions :deep(svg) {
  width: 13px;
  height: 13px;
}
.snippet {
  display: block;
  width: 100%;
  margin: 0 0 var(--sp-2);
  padding: 6px 0;
  border: 1px solid var(--line);
  border-left: 2px solid color-mix(in srgb, var(--accent) 60%, transparent);
  border-radius: var(--r-sm);
  background: var(--bg);
  text-align: left;
  overflow-x: auto;
}
.snippet:hover {
  border-color: var(--line-strong);
  border-left-color: var(--accent);
}
.snippet-row {
  display: flex;
  gap: 10px;
  padding: 0 10px;
  font: var(--fs-2xs) / 1.5 var(--mono);
  white-space: pre;
}
.snippet-no {
  flex-shrink: 0;
  min-width: 28px;
  text-align: right;
  color: var(--faint);
  user-select: none;
}
.snippet-code {
  color: var(--text-2);
}
.remark-text {
  margin: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh);
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.edit-form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}
.edit-error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
