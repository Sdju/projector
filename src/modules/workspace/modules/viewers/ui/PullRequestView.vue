<script setup lang="ts">
import { ref, watch } from "vue";
import type {
  PullRequestDetail,
  PullRequestFile,
  PullRequestReview,
} from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
import IconExternal from "~icons/lucide/external-link";

/** Вкладка pull request: метаданные, Markdown-описание, ревью, обсуждение и изменённые файлы. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const detail = ref<PullRequestDetail>();
const loading = ref(false);
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  detail.value = undefined;
  try {
    const data = await workspaceRequest<PullRequestDetail>(props.projectId, "pull", {
      number: String(props.number),
    });
    if (current !== generation) return;
    detail.value = data;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось открыть pull request";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.projectId, props.number], load, { immediate: true });

const STATE_LABEL = { open: "открыт", closed: "закрыт", merged: "влит" } as const;
const REVIEW_LABEL: Record<PullRequestReview["state"], string> = {
  approved: "одобрил",
  changes_requested: "запросил изменения",
  commented: "прокомментировал",
  dismissed: "ревью отклонено",
  pending: "черновик ревью",
};
const FILE_MARK: Record<PullRequestFile["status"], string> = {
  added: "A",
  removed: "D",
  modified: "M",
  renamed: "R",
  copied: "C",
  changed: "M",
  unchanged: "·",
};
const filePath = (file: PullRequestFile) =>
  file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
</script>

<template>
  <div class="pull-view">
    <p v-if="loading" class="note" role="status">загрузка pull request…</p>
    <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
    <article v-else-if="detail" class="pull-article">
      <header class="pull-head">
        <span class="state" :class="detail.pull.state">
          {{
            detail.pull.draft && detail.pull.state === "open"
              ? "черновик"
              : STATE_LABEL[detail.pull.state]
          }}
        </span>
        <h2>
          {{ detail.pull.title }} <span class="number">#{{ detail.pull.number }}</span>
        </h2>
      </header>
      <p class="meta">
        <span class="author">
          <UiAvatar
            :src="detail.pull.author.avatarUrl"
            :alt="detail.pull.author.login"
            :size="18"
          />
          {{ detail.pull.author.login }}
        </span>
        <span class="branches">{{ detail.pull.head }} → {{ detail.pull.base }}</span>
        <span :title="absoluteTime(detail.pull.createdAt)"
          >открыт {{ relativeTime(detail.pull.createdAt) }}</span
        >
        <a
          v-if="detail.pull.htmlUrl"
          class="external"
          :href="detail.pull.htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на GitHub
        </a>
      </p>
      <p class="meta">
        <span>{{ detail.commits }} коммитов</span>
        <span>{{ detail.changedFiles }} файлов</span>
        <span class="add">+{{ detail.additions }}</span>
        <span class="del">−{{ detail.deletions }}</span>
      </p>
      <ul v-if="detail.pull.labels.length" class="labels">
        <li
          v-for="label in detail.pull.labels"
          :key="label.name"
          :style="{ borderColor: label.color ? `#${label.color}` : undefined }"
        >
          {{ label.name }}
        </li>
      </ul>

      <VisualMarkdownEditor
        v-if="detail.pull.body"
        class="body"
        :content="detail.pull.body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
        @open="emit('open', $event)"
      />
      <p v-else class="note">Без описания</p>

      <template v-if="detail.reviews.length">
        <h3>Ревью</h3>
        <ul class="comment-list">
          <li v-for="item in detail.reviews" :key="item.id">
            <p class="comment-meta">
              <span class="author">
                <UiAvatar :src="item.author.avatarUrl" :alt="item.author.login" :size="16" />
                {{ item.author.login }}
              </span>
              <span class="review" :class="item.state">{{ REVIEW_LABEL[item.state] }}</span>
              <span :title="absoluteTime(item.submittedAt)">{{
                relativeTime(item.submittedAt)
              }}</span>
            </p>
            <VisualMarkdownEditor
              v-if="item.body"
              :content="item.body"
              path=""
              :project-id="projectId"
              :editable="false"
              compact
              @open="emit('open', $event)"
            />
          </li>
        </ul>
      </template>

      <h3>Изменённые файлы</h3>
      <p v-if="!detail.files.length" class="note">Файлов нет</p>
      <ul v-else class="file-list">
        <li v-for="file in detail.files" :key="file.path">
          <span class="mark" :class="file.status" :title="file.status">{{
            FILE_MARK[file.status]
          }}</span>
          <span class="path" :title="filePath(file)">{{ filePath(file) }}</span>
          <span class="add">+{{ file.additions }}</span>
          <span class="del">−{{ file.deletions }}</span>
        </li>
      </ul>
      <p v-if="detail.filesTruncated" class="note">
        Показано {{ detail.files.length }} из {{ detail.changedFiles }} файлов. Остальные — на
        GitHub.
      </p>

      <h3>Обсуждение</h3>
      <p v-if="!detail.comments.length" class="note">Комментариев нет</p>
      <ul v-else class="comment-list">
        <li v-for="comment in detail.comments" :key="comment.id">
          <p class="comment-meta">
            <span class="author">
              <UiAvatar :src="comment.author.avatarUrl" :alt="comment.author.login" :size="16" />
              {{ comment.author.login }}
            </span>
            <span :title="absoluteTime(comment.createdAt)">{{
              relativeTime(comment.createdAt)
            }}</span>
          </p>
          <VisualMarkdownEditor
            :content="comment.body"
            path=""
            :project-id="projectId"
            :editable="false"
            compact
            @open="emit('open', $event)"
          />
        </li>
      </ul>
      <p v-if="detail.commentsTruncated" class="note">
        Показаны первые 500 комментариев. Откройте pull request на GitHub, чтобы увидеть все.
      </p>
    </article>
  </div>
</template>

<style scoped>
.pull-view {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.pull-article {
  max-width: 880px;
  margin: 0 auto;
}
.pull-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  flex-wrap: wrap;
}
.state {
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--active);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state.open {
  background: color-mix(in srgb, var(--run) 22%, transparent);
  color: var(--run);
}
.state.merged {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}
.number {
  color: var(--muted);
  font: var(--fs-xs) var(--mono);
}
.meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.author {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  color: var(--text-2);
}
.branches {
  font-family: var(--mono);
  color: var(--text-2);
}
.external {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-2);
}
.external svg {
  width: 13px;
  height: 13px;
}
.add {
  color: var(--run);
  font-family: var(--mono);
}
.del {
  color: var(--err);
  font-family: var(--mono);
}
.labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: 0;
}
.labels li {
  padding: 1px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
h3 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 500;
}
.body {
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.comment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.comment-list li {
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.comment-meta {
  display: flex;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.review.approved {
  color: var(--run);
}
.review.changes_requested {
  color: var(--err);
}
.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.file-list li {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) var(--sp-3);
  font-size: var(--fs-xs);
}
.file-list li + li {
  border-top: 1px solid var(--line);
}
.mark {
  width: 14px;
  color: var(--muted);
  font-family: var(--mono);
  text-align: center;
}
.mark.added {
  color: var(--run);
}
.mark.removed {
  color: var(--err);
}
.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
  color: var(--text-2);
}
.note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note.error {
  color: var(--err);
}
</style>
