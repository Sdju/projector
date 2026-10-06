<script setup lang="ts">
import type { IssueLabel, IssueUser } from "../../../../../../core/modules/workspace/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
import IconExternal from "~icons/lucide/external-link";

/**
 * Каркас вкладки issue / pull request: состояние, заголовок, автор, метки и Markdown-тело;
 * разделы вкладки (ревью, файлы, комментарии) приходят слотом.
 */
defineProps<{
  projectId: string;
  loading: boolean;
  error: string;
  /** Загрузка идёт, данных ещё нет. */
  ready: boolean;
  noun: string;
  state: string;
  stateLabel: string;
  title: string;
  number: number;
  author: IssueUser;
  createdAt: string;
  htmlUrl: string;
  labels: IssueLabel[];
  body: string;
}>();
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <div class="tracker-detail">
    <p v-if="loading" class="note" role="status">загрузка: {{ noun }}…</p>
    <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
    <article v-else-if="ready" class="article">
      <header class="head">
        <span class="state" :class="state">{{ stateLabel }}</span>
        <h2>
          {{ title }} <span class="number">#{{ number }}</span>
        </h2>
      </header>
      <p class="meta">
        <span class="author">
          <UiAvatar :src="author.avatarUrl" :alt="author.login" :size="18" />
          {{ author.login }}
        </span>
        <slot name="meta" />
        <span :title="absoluteTime(createdAt)">открыт {{ relativeTime(createdAt) }}</span>
        <a
          v-if="htmlUrl"
          class="external"
          :href="htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на GitHub
        </a>
      </p>
      <slot name="stats" />
      <ul v-if="labels.length" class="labels">
        <li
          v-for="label in labels"
          :key="label.name"
          :style="{ borderColor: label.color ? `#${label.color}` : undefined }"
        >
          {{ label.name }}
        </li>
      </ul>
      <VisualMarkdownEditor
        v-if="body"
        class="body"
        :content="body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
        @open="emit('open', $event)"
      />
      <p v-else class="note">Без описания</p>
      <slot />
    </article>
  </div>
</template>

<style scoped>
.tracker-detail {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.article {
  max-width: 880px;
  margin: 0 auto;
}
.head {
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
.state.merged,
.state.answered {
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
.body {
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
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
