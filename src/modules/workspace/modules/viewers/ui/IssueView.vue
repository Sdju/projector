<script setup lang="ts">
import { computed } from "vue";
import type { IssueDetail } from "../../../../../../core/modules/workspace/index.ts";
import { useTrackerDetail } from "../lib/tracker-detail.ts";
import TrackerComments from "./TrackerComments.vue";
import TrackerDetail from "./TrackerDetail.vue";

/** Вкладка обсуждения issue: метаданные, Markdown-тело и комментарии. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const { detail, loading, error } = useTrackerDetail<IssueDetail>(
  () => props.projectId,
  () => props.number,
  "issue",
  "Не удалось открыть issue",
);
const comments = computed(() =>
  (detail.value?.comments ?? []).map((item) => ({ ...item, at: item.createdAt })),
);
</script>

<template>
  <TrackerDetail
    :project-id="projectId"
    :loading="loading"
    :error="error"
    :ready="!!detail"
    noun="issue"
    :state="detail?.issue.state ?? ''"
    :state-label="detail?.issue.state === 'closed' ? 'закрыт' : 'открыт'"
    :title="detail?.issue.title ?? ''"
    :number="detail?.issue.number ?? number"
    :author="detail?.issue.author ?? { login: '', avatarUrl: '' }"
    :created-at="detail?.issue.createdAt ?? ''"
    :html-url="detail?.issue.htmlUrl ?? ''"
    :labels="detail?.issue.labels ?? []"
    :body="detail?.issue.body ?? ''"
    :reactions="detail?.issue.reactions ?? []"
    @open="emit('open', $event)"
  >
    <template #meta>
      <span v-if="detail?.issue.comments">{{ detail.issue.comments }} комментариев</span>
    </template>
    <TrackerComments
      :project-id="projectId"
      title="Комментарии"
      empty="Комментариев нет"
      :items="comments"
      @open="emit('open', $event)"
    />
    <p v-if="detail?.commentsTruncated" class="note">
      Показаны первые 500 комментариев. Откройте issue на GitHub, чтобы увидеть все.
    </p>
  </TrackerDetail>
</template>

<style scoped>
.note {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
