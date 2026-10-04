<script setup lang="ts">
import { ref, watch } from "vue";
import type { IssueDetail } from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
import IconExternal from "~icons/lucide/external-link";

/** Вкладка обсуждения issue: метаданные, Markdown-тело и комментарии. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const detail = ref<IssueDetail>();
const loading = ref(false);
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  detail.value = undefined;
  try {
    const data = await workspaceRequest<IssueDetail>(props.projectId, "issue", {
      number: String(props.number),
    });
    if (current !== generation) return;
    detail.value = data;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось открыть issue";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.projectId, props.number], load, { immediate: true });
</script>

<template>
  <div class="issue-view">
    <p v-if="loading" class="note" role="status">загрузка issue…</p>
    <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
    <article v-else-if="detail" class="issue-article">
      <header class="issue-head">
        <span class="state" :class="detail.issue.state">
          {{ detail.issue.state === "closed" ? "закрыт" : "открыт" }}
        </span>
        <h2>
          {{ detail.issue.title }} <span class="number">#{{ detail.issue.number }}</span>
        </h2>
      </header>
      <p class="meta">
        <span class="author">
          <UiAvatar
            :src="detail.issue.author.avatarUrl"
            :alt="detail.issue.author.login"
            :size="18"
          />
          {{ detail.issue.author.login }}
        </span>
        <span :title="absoluteTime(detail.issue.createdAt)"
          >открыт {{ relativeTime(detail.issue.createdAt) }}</span
        >
        <span v-if="detail.issue.comments">· {{ detail.issue.comments }} комментариев</span>
        <a
          v-if="detail.issue.htmlUrl"
          class="external"
          :href="detail.issue.htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на GitHub
        </a>
      </p>
      <ul v-if="detail.issue.labels.length" class="labels">
        <li
          v-for="label in detail.issue.labels"
          :key="label.name"
          :style="{ borderColor: label.color ? `#${label.color}` : undefined }"
        >
          {{ label.name }}
        </li>
      </ul>

      <VisualMarkdownEditor
        v-if="detail.issue.body"
        class="body"
        :content="detail.issue.body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
        @open="emit('open', $event)"
      />
      <p v-else class="note">Без описания</p>

      <h3>Комментарии</h3>
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
        Показаны первые 500 комментариев. Откройте issue на GitHub, чтобы увидеть все.
      </p>
    </article>
  </div>
</template>

<style scoped>
.issue-view {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.issue-article {
  max-width: 880px;
  margin: 0 auto;
}
.issue-head {
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
.note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note.error {
  color: var(--err);
}
</style>
