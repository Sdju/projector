<script setup lang="ts">
import type { IssueUser } from "../../../../../../core/modules/workspace/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";

/** Раздел вкладки: заголовок и карточки с Markdown (комментарии, ревью). */
export interface TrackerComment {
  id: number;
  author: IssueUser;
  body: string;
  /** ISO-время; пусто — не показывать. */
  at: string;
  /** Пометка после автора (состояние ревью) и её класс. */
  badge?: string;
  badgeClass?: string;
}
defineProps<{ projectId: string; title: string; empty?: string; items: TrackerComment[] }>();
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <h3>{{ title }}</h3>
  <p v-if="!items.length" class="note">{{ empty }}</p>
  <ul v-else class="comment-list">
    <li v-for="item in items" :key="item.id">
      <p class="comment-meta">
        <span class="author">
          <UiAvatar :src="item.author.avatarUrl" :alt="item.author.login" :size="16" />
          {{ item.author.login }}
        </span>
        <span v-if="item.badge" :class="item.badgeClass">{{ item.badge }}</span>
        <span v-if="item.at" :title="absoluteTime(item.at)">{{ relativeTime(item.at) }}</span>
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

<style scoped>
h3 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 500;
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
.author {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--mono);
  color: var(--text-2);
}
.approved {
  color: var(--run);
}
.changes_requested {
  color: var(--err);
}
.note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
