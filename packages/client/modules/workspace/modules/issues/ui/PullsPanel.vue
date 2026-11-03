<script setup lang="ts">
import type { PullRequest } from "@projector/core/modules/workspace/index.ts";
import {
  PIPELINE_STATUS_LABEL,
  PIPELINE_STATUS_TONE,
} from "@projector/core/modules/workspace/index.ts";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import { computed } from "vue";
import { usePagedList } from "../lib/paged-list.ts";
import { useTrackerPanel } from "../lib/tracker-panel.ts";
import TrackerPanel from "./TrackerPanel.vue";
import TrackerRow from "./TrackerRow.vue";
import IconOpen from "~icons/lucide/git-pull-request";
import IconDraft from "~icons/lucide/git-pull-request-draft";
import IconClosed from "~icons/lucide/git-pull-request-closed";
import IconMerged from "~icons/lucide/git-merge";
import IconMessage from "~icons/lucide/message-square";

/** Сайдбар-блок трекера (pull requests, merge requests): состояние, список и подгрузка страниц. */
const props = withDefaults(
  defineProps<{
    projectId: string;
    active: boolean;
    /** Заголовок блока и подпись пустого списка. */
    title?: string;
    noun?: string;
    singular?: string;
    /** Вид команд: `pulls` → `ide.pulls.*`, `mergeRequests` → `ide.mergeRequests.*`. */
    kind?: string;
    /** Хост в описаниях команд. */
    host?: string;
    /** Действие провайдера, отдающее список. */
    action?: string;
  }>(),
  {
    title: "Pull requests",
    noun: "pull requests",
    singular: "pull request",
    kind: "pulls",
    host: "GitHub",
    action: "pulls",
  },
);
const emit = defineEmits<{
  open: [pull: { number: number; title: string }, pinned?: boolean];
}>();
const list = usePagedList<PullRequest>(
  () => props.projectId,
  props.action,
  "pulls",
  `Не удалось прочитать ${props.noun}`,
);
const { commands, open } = useTrackerPanel({
  kind: props.kind,
  plural: props.noun,
  singular: props.singular,
  host: props.host,
  opens: "описание, ревью, обсуждение и изменённые файлы",
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (pull, pinned) => emit("open", pull, pinned),
});
/** Все действия блока идут через `ide.<kind>.*`: у GitLab это `ide.mergeRequests.*`. */
const run = (action: string, args?: unknown) => commands.run(`ide.${props.kind}.${action}`, args);
const stateIcon = (pull: PullRequest) =>
  pull.state === "merged"
    ? IconMerged
    : pull.state === "closed"
      ? IconClosed
      : pull.draft
        ? IconDraft
        : IconOpen;
const stateClass = (pull: PullRequest) =>
  pull.draft && pull.state === "open" ? "draft" : pull.state;
/** GitLab has a separate `merged` state; GitHub shows merged requests under `closed`. */
const states = computed(() =>
  props.kind === "mergeRequests"
    ? [
        { value: "open" as const, label: "открытые" },
        { value: "closed" as const, label: "закрытые" },
        { value: "merged" as const, label: "влитые" },
        { value: "all" as const, label: "все" },
      ]
    : undefined,
);
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <TrackerPanel
    :title="title"
    :noun="noun"
    :prefix="`ide.${kind}`"
    :open="open"
    :count="list.items.value.length"
    :state="list.state.value"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    :states="states"
    @toggle="run('block.toggle')"
    @filter="run('filter', { state: $event })"
    @more="run('more')"
  >
    <li v-for="pull in list.items.value" :key="pull.number">
      <TrackerRow
        :number="pull.number"
        :title="pull.title"
        :labels="pull.labels"
        :author="pull.author"
        @click="run('open', { number: pull.number, title: pull.title })"
        @dblclick="run('open', { number: pull.number, title: pull.title, pinned: true })"
      >
        <template #icon>
          <component
            :is="stateIcon(pull)"
            class="state"
            :class="stateClass(pull)"
            aria-hidden="true"
          />
        </template>
        <template #meta>
          <span class="branches u-truncate" :title="`${pull.head} → ${pull.base}`">
            {{ pull.head }} → {{ pull.base }}
          </span>
          <span
            v-if="pull.pipeline"
            class="ci"
            :title="`Pipeline #${pull.pipeline.id}: ${PIPELINE_STATUS_LABEL[pull.pipeline.status]}`"
          >
            <UiStatusDot :tone="PIPELINE_STATUS_TONE[pull.pipeline.status]" shrink />
          </span>
          <span v-if="pull.hasConflicts" class="conflict" title="Есть конфликты">конфликт</span>
          <span v-if="pull.comments" class="comments" :title="`${pull.comments} комментариев`">
            <IconMessage aria-hidden="true" />{{ pull.comments }}
          </span>
        </template>
      </TrackerRow>
    </li>
  </TrackerPanel>
</template>

<style scoped>
.state {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  color: var(--muted);
}
.state.open {
  color: var(--run);
}
.state.merged {
  color: var(--accent);
}
.branches {
  min-width: 0;
  font-family: var(--mono);
}
.ci,
.comments {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.comments svg {
  width: 11px;
  height: 11px;
}
.conflict {
  flex-shrink: 0;
  color: var(--err);
}
</style>
