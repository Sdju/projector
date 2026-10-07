<script setup lang="ts">
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import { computed } from "vue";
import type {
  DiscussionComment,
  DiscussionDetail,
} from "../../../../../../core/modules/workspace/index.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { useTrackerDetail } from "../lib/tracker-detail.ts";
import TrackerComments, { type TrackerComment } from "./TrackerComments.vue";
import TrackerDetail from "./TrackerDetail.vue";

/** Вкладка discussion: метаданные, Markdown-тело, комментарии и ответы на них. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const { detail, loading, error } = useTrackerDetail<DiscussionDetail>(
  () => props.projectId,
  () => props.number,
  "discussion",
  "Не удалось открыть discussion",
);

const item = (comment: DiscussionComment, depth: number): TrackerComment => ({
  ...comment,
  at: comment.createdAt,
  depth,
  badge: comment.isAnswer ? "ответ" : undefined,
  badgeClass: comment.isAnswer ? "answer" : undefined,
});
/** Ответы идут сразу за своим комментарием, на один уровень глубже. */
const comments = computed(() =>
  (detail.value?.comments ?? []).flatMap((comment) => [
    item(comment, 0),
    ...comment.replies.map((reply) => item(reply, 1)),
  ]),
);
const truncatedReplies = computed(() =>
  (detail.value?.comments ?? []).some((comment) => comment.repliesTruncated),
);
const state = computed(() => {
  const discussion = detail.value?.discussion;
  if (discussion?.closed) return "closed";
  return discussion?.answered ? "answered" : "open";
});
const STATE_LABEL = { open: "открыто", closed: "закрыто", answered: "есть ответ" } as const;

// Что штатный агент видит во вкладке discussion: состояние, категория, голоса и комментарии.
useTabReadout(() => {
  const note = `Discussion #${detail.value?.discussion.number ?? props.number}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = detail.value;
  if (!data) return { note, text: "Загрузка…" };
  const discussion = data.discussion;
  const body =
    discussion.body.length > 4000 ? `${discussion.body.slice(0, 4000)}…` : discussion.body;
  const lines = data.comments.flatMap((comment) => [
    `${comment.isAnswer ? "[ответ] " : ""}${comment.author.login}`,
    ...comment.replies.map((reply) => `  ↳ ${reply.author.login}`),
  ]);
  const shown = lines.slice(0, 200);
  return {
    note,
    text: readoutLines(
      `Состояние: ${STATE_LABEL[state.value]}`,
      `${discussion.title} (#${discussion.number})`,
      `Автор: ${discussion.author.login}, создано ${discussion.createdAt}`,
      discussion.category.name ? `Категория: ${discussion.category.name}` : "",
      discussion.labels.length
        ? `Метки: ${discussion.labels.map((label) => label.name).join(", ")}`
        : "Метки: нет",
      `Голосов: ${discussion.upvotes}`,
      lines.length
        ? `Комментарии (${data.comments.length}):\n${shown.join("\n")}${
            lines.length > shown.length ? `\n… ещё ${lines.length - shown.length}` : ""
          }`
        : "Комментариев: нет",
      data.commentsTruncated ? "Комментарии показаны не все." : "",
      truncatedReplies.value ? "Ответы на комментарии показаны не все." : "",
      body,
    ),
  };
});
</script>

<template>
  <TrackerDetail
    :project-id="projectId"
    :loading="loading"
    :error="error"
    :ready="!!detail"
    noun="discussion"
    :state="state"
    :state-label="STATE_LABEL[state as keyof typeof STATE_LABEL]"
    :title="detail?.discussion.title ?? ''"
    :number="detail?.discussion.number ?? number"
    :author="detail?.discussion.author ?? { login: '', avatarUrl: '' }"
    :created-at="detail?.discussion.createdAt ?? ''"
    :html-url="detail?.discussion.htmlUrl ?? ''"
    :labels="detail?.discussion.labels ?? []"
    :body="detail?.discussion.body ?? ''"
    :reactions="detail?.discussion.reactions ?? []"
    @open="emit('open', $event)"
  >
    <template #meta>
      <span v-if="detail?.discussion.category.name" class="category"
        ><EmojiText :text="detail.discussion.category.emoji" />
        {{ detail.discussion.category.name }}</span
      >
      <span v-if="detail?.discussion.upvotes">▲ {{ detail.discussion.upvotes }}</span>
    </template>
    <TrackerComments
      :project-id="projectId"
      title="Комментарии"
      empty="Комментариев нет"
      :items="comments"
      @open="emit('open', $event)"
    />
    <p v-if="truncatedReplies" class="note">
      У некоторых комментариев показаны не все ответы. Откройте discussion на GitHub, чтобы увидеть
      все.
    </p>
    <p v-if="detail?.commentsTruncated" class="note">
      Показаны первые 250 комментариев. Откройте discussion на GitHub, чтобы увидеть все.
    </p>
  </TrackerDetail>
</template>

<style scoped>
.category {
  color: var(--text-2);
}
.note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
