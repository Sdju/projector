<script setup lang="ts">
import UiCard from "../../../../../common/ui/UiCard.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import type { IssueUser, Reaction } from "../../../../../../core/modules/workspace/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import TrackerAuthor from "./TrackerAuthor.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import TrackerReactions from "./TrackerReactions.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";

/** Раздел вкладки: заголовок и карточки с Markdown (комментарии, ревью). */
export interface TrackerComment {
  id: number;
  author: IssueUser;
  body: string;
  reactions?: Reaction[];
  /** ISO-время; пусто — не показывать. */
  at: string;
  /** Пометка после автора (состояние ревью) и её класс. */
  badge?: string;
  badgeClass?: string;
  /** Уровень вложенности ответа: 0 — комментарий верхнего уровня. */
  depth?: number;
}
defineProps<{ projectId: string; title: string; empty?: string; items: TrackerComment[] }>();
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <UiHeading as="h3" size="sm" tone="secondary" :space-before="4" :space-after="2">{{
    title
  }}</UiHeading>
  <UiHint size="xs" leading="inherit" :space-before="2" v-if="!items.length" class="note">{{
    empty
  }}</UiHint>
  <ul v-else class="comment-list">
    <UiCard
      as="li"
      appearance="frame"
      v-for="item in items"
      :key="item.id"
      :class="{ reply: item.depth }"
      :style="item.depth ? { marginLeft: `calc(var(--sp-4) * ${item.depth})` } : undefined"
    >
      <UiInline as="p" class="comment-meta" align="stretch">
        <TrackerAuthor :author="item.author" :size="16" />
        <span v-if="item.badge" :class="item.badgeClass">{{ item.badge }}</span>
        <span v-if="item.at" :title="absoluteTime(item.at)">{{ relativeTime(item.at) }}</span>
      </UiInline>
      <VisualMarkdownEditor
        v-if="item.body"
        :content="item.body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
        @open="emit('open', $event)"
      />
      <TrackerReactions :reactions="item.reactions ?? []" />
    </UiCard>
  </ul>
</template>

<style scoped>
.comment-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.comment-list li.reply {
  background: var(--active);
}
.comment-meta {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.approved,
.answer {
  color: var(--run);
}
.changes_requested {
  color: var(--err);
}
</style>
