<script setup lang="ts">
import { computed } from "vue";
import type {
  PullRequestDetail,
  PullRequestFile,
  PullRequestReview,
} from "../../../../../../core/modules/workspace/index.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { useTrackerDetail } from "../lib/tracker-detail.ts";
import TrackerComments from "./TrackerComments.vue";
import TrackerDetail from "./TrackerDetail.vue";

/** Вкладка pull request: метаданные, Markdown-описание, ревью, обсуждение и изменённые файлы. */
const props = defineProps<{ projectId: string; number: number }>();
const emit = defineEmits<{ open: [path: string] }>();
const { detail, loading, error } = useTrackerDetail<PullRequestDetail>(
  () => props.projectId,
  () => props.number,
  "pull",
  "Не удалось открыть pull request",
);

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
const reviews = computed(() =>
  (detail.value?.reviews ?? []).map((item) => ({
    ...item,
    at: item.submittedAt,
    badge: REVIEW_LABEL[item.state],
    badgeClass: item.state,
  })),
);
const comments = computed(() =>
  (detail.value?.comments ?? []).map((item) => ({ ...item, at: item.createdAt })),
);
const stateLabel = computed(() => {
  const pull = detail.value?.pull;
  return pull?.draft && pull.state === "open" ? "черновик" : STATE_LABEL[pull?.state ?? "open"];
});

// Что штатный агент видит во вкладке pull request: состояние, ветки, статистика, ревью и файлы.
useTabReadout(() => {
  const note = `PR #${detail.value?.pull.number ?? props.number}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = detail.value;
  if (!data) return { note, text: "Загрузка…" };
  const pull = data.pull;
  const body = pull.body.length > 4000 ? `${pull.body.slice(0, 4000)}…` : pull.body;
  const reviews = data.reviews.map(
    (review) => `${REVIEW_LABEL[review.state]}: ${review.author.login}`,
  );
  const files = data.files.map((file) => `${FILE_MARK[file.status]} ${filePath(file)}`);
  const shown = files.slice(0, 100);
  return {
    note,
    text: readoutLines(
      `Состояние: ${stateLabel.value}`,
      `${pull.title} (#${pull.number})`,
      `Автор: ${pull.author.login}, создано ${pull.createdAt}`,
      `Ветки: ${pull.head} → ${pull.base}`,
      `Коммитов: ${data.commits}, файлов: ${data.changedFiles}, +${data.additions} −${data.deletions}`,
      pull.labels.length
        ? `Метки: ${pull.labels.map((label) => label.name).join(", ")}`
        : "Метки: нет",
      `Комментариев: ${data.comments.length}`,
      reviews.length ? `Ревью (${reviews.length}):\n${reviews.join("\n")}` : "Ревью: нет",
      files.length
        ? `Файлы (${files.length}):\n${shown.join("\n")}${
            files.length > shown.length ? `\n… ещё ${files.length - shown.length}` : ""
          }`
        : "Файлы: нет",
      data.filesTruncated
        ? `Файлы показаны не все (${data.files.length} из ${data.changedFiles}).`
        : "",
      data.commentsTruncated ? "Комментарии показаны не все." : "",
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
    noun="pull request"
    :state="detail?.pull.state ?? ''"
    :state-label="stateLabel"
    :title="detail?.pull.title ?? ''"
    :number="detail?.pull.number ?? number"
    :author="detail?.pull.author ?? { login: '', avatarUrl: '' }"
    :created-at="detail?.pull.createdAt ?? ''"
    :html-url="detail?.pull.htmlUrl ?? ''"
    :labels="detail?.pull.labels ?? []"
    :body="detail?.pull.body ?? ''"
    :reactions="detail?.pull.reactions ?? []"
    @open="emit('open', $event)"
  >
    <template #meta>
      <span class="branches">{{ detail?.pull.head }} → {{ detail?.pull.base }}</span>
    </template>
    <template #stats>
      <p v-if="detail" class="stats">
        <span>{{ detail.commits }} коммитов</span>
        <span>{{ detail.changedFiles }} файлов</span>
        <span class="add">+{{ detail.additions }}</span>
        <span class="del">−{{ detail.deletions }}</span>
      </p>
    </template>
    <TrackerComments
      v-if="reviews.length"
      :project-id="projectId"
      title="Ревью"
      :items="reviews"
      @open="emit('open', $event)"
    />
    <template v-if="detail">
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
    </template>
    <TrackerComments
      :project-id="projectId"
      title="Обсуждение"
      empty="Комментариев нет"
      :items="comments"
      @open="emit('open', $event)"
    />
    <p v-if="detail?.commentsTruncated" class="note">
      Показаны первые 500 комментариев. Откройте pull request на GitHub, чтобы увидеть все.
    </p>
  </TrackerDetail>
</template>

<style scoped>
.branches {
  font-family: var(--mono);
  color: var(--text-2);
}
.stats {
  display: flex;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.add {
  color: var(--run);
  font-family: var(--mono);
}
.del {
  color: var(--err);
  font-family: var(--mono);
}
h3 {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-sm);
  color: var(--text-2);
  font-weight: 500;
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
</style>
