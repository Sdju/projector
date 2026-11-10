<script setup lang="ts">
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed } from "vue";
import type {
  PullRequestDetail,
  PullRequestFile,
  PullRequestReview,
} from "@projector-ai/core/modules/workspace/index.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import {
  mergeStatusLabel,
  mergeStatusTone,
  PIPELINE_STATUS_LABEL,
} from "@projector-ai/core/modules/workspace/index.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import type { SidebarType } from "../../../../workspace-api/index.ts";
import { useTrackerDetail } from "../lib/tracker-detail.ts";
import { usePullDiffs } from "../lib/pull-diffs.ts";
import TrackerComments from "./TrackerComments.vue";
import TrackerDetail from "./TrackerDetail.vue";
import PullRequestFiles from "./PullRequestFiles.vue";
import PullRequestPipeline from "./PullRequestPipeline.vue";

/** Вкладка pull request: метаданные, Markdown-описание, ревью, обсуждение и изменённые файлы. */
const props = withDefaults(
  defineProps<{
    projectId: string;
    number: number;
    /** Хост в ссылке «на …» и подсказках: «GitHub» или «GitLab». */
    host?: string;
    /** Короткая подпись в readout: «PR» у GitHub, «MR» у GitLab. */
    short?: string;
    noun?: string;
    /** Workspace actions: a temporary tree section and a base → head file tab. */
    onOpenSection?: (type: SidebarType) => void;
    onOpenPullFile?: (number: number, path: string, head?: string, pinned?: boolean) => void;
    onOpenJob?: (job: { id: number; title: string }) => void;
  }>(),
  { host: "GitHub", short: "PR", noun: "pull request" },
);
const emit = defineEmits<{
  open: [path: string];
  openPipeline: [pipeline: { id: number; title?: string }];
}>();
const { detail, loading, error, reload } = useTrackerDetail<PullRequestDetail>(
  () => props.projectId,
  () => props.number,
  "pull",
  `Не удалось открыть ${props.noun}`,
);
const headSha = computed(() => detail.value?.diffRefs?.headSha ?? "");
const mergeStatus = computed(() => detail.value?.mergeStatus ?? "");
const {
  expanded,
  heights,
  diffs,
  toggle: toggleFile,
} = usePullDiffs(
  () => props.projectId,
  () => props.number,
  () => headSha.value,
);
const textFiles = computed(() =>
  (detail.value?.files ?? []).filter((file) => !file.binary && !file.tooLarge),
);
const commands = useCommandScope(`merge-request:${props.projectId}:${props.number}`, () => ({
  surface: "merge-request",
  projectId: props.projectId,
  number: props.number,
}));
const register = useCommandRegistrar(commands.scope);

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
const pipeline = computed(() => detail.value?.pipeline ?? null);
const approvedLogins = computed(
  () => new Set((detail.value?.reviews ?? []).map((review) => review.author.login)),
);
/** Reviewers with the state the approvals endpoint exposes; approvers missing from the list are added. */
const reviewers = computed(() => {
  const seen = new Set<string>();
  const rows = (detail.value?.reviewers ?? []).map((author) => {
    seen.add(author.login);
    return { author, approved: approvedLogins.value.has(author.login) };
  });
  for (const author of detail.value?.approvals?.approvedBy ?? []) {
    if (seen.has(author.login)) continue;
    seen.add(author.login);
    rows.push({ author, approved: true });
  }
  return rows.sort((left, right) => Number(right.approved) - Number(left.approved));
});
const openPipeline = () => {
  if (pipeline.value) emit("openPipeline", { id: pipeline.value.id, title: pipeline.value.name });
};
const openChangesTree = () => {
  const detailValue = detail.value;
  props.onOpenSection?.({
    id: `merge-request-files:${props.number}`,
    title: `Изменения !${props.number}`,
    source: "Только чтение · MR",
    group: "merge-requests",
    kind: "merge-request-files",
    params: {
      number: props.number,
      head: headSha.value,
      ...(detailValue
        ? {
            snapshot: {
              files: detailValue.files,
              changedFiles: detailValue.changedFiles,
              changedFilesCapped: detailValue.changedFilesCapped === true,
              filesTruncated: detailValue.filesTruncated,
              ...(detailValue.diffRefs ? { diffRefs: detailValue.diffRefs } : {}),
            },
          }
        : {}),
    },
    closable: true,
  });
};
const openFile = (path: string, pinned = false) =>
  props.onOpenPullFile?.(props.number, path, headSha.value, pinned);
const openJob = (job: { id: number; title: string }) => props.onOpenJob?.(job);
register(
  "ide.mergeRequest.refresh",
  "Обновить merge request",
  "Перечитывает состояние, ревью, обсуждение и изменённые файлы merge request.",
  () => reload(),
);
register(
  "ide.mergeRequest.files.open",
  "Дерево изменений merge request",
  "Открывает временный раздел боковой панели с деревом изменённых файлов merge request.",
  () => openChangesTree(),
);
register(
  "ide.mergeRequest.file.open",
  "Открыть изменения файла merge request",
  "Открывает файл merge request отдельной вкладкой base → head.",
  (value) => {
    const { path, pinned } = commandArgs(value);
    if (typeof path !== "string" || !path) throw new Error("Укажите path файла");
    openFile(path, pinned === true);
  },
  {
    path: "string: путь файла в merge request",
    pinned: "boolean (необязательно): true — постоянная вкладка",
  },
);
register(
  "ide.mergeRequest.file.toggle",
  "Раскрыть изменения файла merge request",
  "Раскрывает diff файла прямо в карточке merge request.",
  async (value) => {
    const { path, open } = commandArgs(value);
    if (typeof path !== "string" || !path) throw new Error("Укажите path файла");
    if (open !== undefined && typeof open !== "boolean")
      throw new Error("open должен быть boolean");
    await toggleFile(path, open as boolean | undefined);
  },
  { path: "string: путь файла", open: "boolean (необязательно): true/false" },
);
register(
  "ide.mergeRequest.files.toggleAll",
  "Раскрыть или свернуть все файлы merge request",
  "Раскрывает diff всех текстовых файлов merge request или сворачивает их.",
  async (value) => {
    const { open } = commandArgs(value);
    const expand = typeof open === "boolean" ? open : expanded.value.size === 0;
    if (!expand) {
      expanded.value.clear();
      return;
    }
    await Promise.all(textFiles.value.map((file) => toggleFile(file.path, true)));
  },
  { open: "boolean (необязательно): true — раскрыть всё, false — свернуть" },
);
register(
  "ide.mergeRequest.pipeline.open",
  "Открыть pipeline merge request",
  "Открывает вкладку последнего pipeline источника merge request.",
  () => openPipeline(),
);
register(
  "ide.mergeRequest.pipeline.job.open",
  "Открыть джоб merge request",
  "Открывает вкладку джоба pipeline merge request.",
  (value) => {
    const { id, title } = commandArgs(value);
    if (typeof id !== "number") throw new Error("Укажите номер джоба");
    openJob({ id, title: typeof title === "string" ? title : "" });
  },
  { id: "number: номер джоба", title: "string (необязательно): заголовок" },
);

// Что штатный агент видит во вкладке pull request: состояние, ветки, статистика, ревью и файлы.
useTabReadout(() => {
  const note = `${props.short} #${detail.value?.pull.number ?? props.number}`;
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
      mergeStatus.value ? `Готовность: ${mergeStatusLabel(mergeStatus.value)}` : "",
      data.diffRefs
        ? `Diff: ${data.diffRefs.baseSha.slice(0, 7)}..${data.diffRefs.headSha.slice(0, 7)}`
        : "Diff ещё не подготовлен",
      `Коммитов: ${data.commits}, файлов: ${data.changedFiles}, +${data.additions} −${data.deletions}`,
      data.pipeline
        ? `Pipeline: #${data.pipeline.id} ${PIPELINE_STATUS_LABEL[data.pipeline.status]}`
        : "",
      reviewers.value.length
        ? `Ревьюеры: ${reviewers.value
            .map((reviewer) => `${reviewer.author.login}${reviewer.approved ? " (одобрил)" : ""}`)
            .join(", ")}`
        : "",
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
        ? `Файлы показаны не все (${data.files.length} из ${data.changedFiles}${data.changedFilesCapped ? "+" : ""}).`
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
    :noun="noun"
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
    :host="host"
    @open="emit('open', $event)"
  >
    <template #meta>
      <span class="branches">{{ detail?.pull.head }} → {{ detail?.pull.base }}</span>
    </template>
    <template #summary>
      <p
        v-if="mergeStatus && !(detail?.pull.draft && mergeStatus === 'draft_status')"
        class="merge-status"
        :class="mergeStatusTone(mergeStatus)"
      >
        <UiStatusDot :tone="mergeStatusTone(mergeStatus)" shrink />
        <span>{{ mergeStatusLabel(mergeStatus) }}</span>
        <span v-if="detail?.hasConflicts" class="conflict">конфликты</span>
        <span v-else-if="detail?.blockingDiscussionsResolved === false" class="conflict"
          >обсуждения не решены</span
        >
      </p>
      <PullRequestPipeline
        v-if="pipeline"
        :project-id="projectId"
        :pipeline="pipeline"
        :host="host"
        @open-pipeline="emit('openPipeline', $event)"
        @open-job="openJob"
      />
      <p v-if="reviewers.length" class="review-line">
        <span class="approvals">Ревьюеры</span>
        <span v-for="reviewer in reviewers" :key="reviewer.author.login" class="reviewer">
          <span :class="{ approved: reviewer.approved }">{{ reviewer.author.login }}</span>
          <span class="reviewer-mark" :class="{ approved: reviewer.approved }">{{
            reviewer.approved ? "✓" : "○"
          }}</span>
        </span>
      </p>
    </template>
    <template #stats>
      <p v-if="detail" class="stats">
        <span>{{ countRu(detail.commits, "коммит", "коммита", "коммитов") }}</span>
        <span
          >{{ countRu(detail.changedFiles, "файл", "файла", "файлов")
          }}{{ detail.changedFilesCapped ? "+" : "" }}</span
        >
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
    <PullRequestFiles
      v-if="detail"
      :files="detail.files"
      :changed-files="detail.changedFiles"
      :changed-files-capped="detail.changedFilesCapped"
      :files-truncated="detail.filesTruncated"
      :diff-refs="detail.diffRefs"
      :host="host"
      :expanded="expanded"
      :heights="heights"
      :diffs="diffs"
      @toggle="(path, open) => commands.run('ide.mergeRequest.file.toggle', { path, open })"
      @toggle-all="commands.run('ide.mergeRequest.files.toggleAll')"
      @open="openFile"
      @open-tree="commands.run('ide.mergeRequest.files.open')"
      @resize="(path, height) => (heights[path] = height)"
    />
    <TrackerComments
      :project-id="projectId"
      title="Обсуждение"
      empty="Комментариев нет"
      :items="comments"
      @open="emit('open', $event)"
    />
    <UiHint
      size="xs"
      leading="inherit"
      :space-before="2"
      v-if="detail?.commentsTruncated"
      class="note"
    >
      Показаны первые 500 комментариев. Откройте {{ noun }} на {{ host }}, чтобы увидеть все.
    </UiHint>
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
.merge-status {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.merge-status.success {
  color: var(--run);
}
.merge-status.warning {
  color: var(--warn);
}
.merge-status.danger {
  color: var(--err);
}
.conflict {
  color: var(--err);
}
.review-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.approvals {
  color: var(--text-2);
}
.reviewer {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--mono);
}
.reviewer .approved {
  color: var(--run);
}
.reviewer-mark {
  color: var(--faint);
}
.reviewer-mark.approved {
  color: var(--run);
}
.add {
  color: var(--run);
  font-family: var(--mono);
}
.del {
  color: var(--err);
  font-family: var(--mono);
}
</style>
