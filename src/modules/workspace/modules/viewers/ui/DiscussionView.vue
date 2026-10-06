<script setup lang="ts">
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import { computed, ref, watch } from "vue";
import type {
  DiscussionComment,
  DiscussionDetail,
} from "../../../../../../core/modules/workspace/index.ts";
import { workspaceRequest } from "../../../../workspace-api/index.ts";
import TrackerComments, { type TrackerComment } from "./TrackerComments.vue";
import TrackerDetail from "./TrackerDetail.vue";

/** Вкладка discussion: метаданные, Markdown-тело, комментарии и ответы на них. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const detail = ref<DiscussionDetail>();
const loading = ref(false);
const error = ref("");
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  detail.value = undefined;
  try {
    const data = await workspaceRequest<DiscussionDetail>(props.projectId, "discussion", {
      number: String(props.number),
    });
    if (current !== generation) return;
    detail.value = data;
  } catch (err) {
    if (current === generation)
      error.value = err instanceof Error ? err.message : "Не удалось открыть discussion";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.projectId, props.number], load, { immediate: true });

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
