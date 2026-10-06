<script setup lang="ts">
import type { PullRequest } from "../../../../../../core/modules/workspace/index.ts";
import { usePagedList } from "../lib/paged-list.ts";
import { useTrackerPanel } from "../lib/tracker-panel.ts";
import TrackerPanel from "./TrackerPanel.vue";
import TrackerRow from "./TrackerRow.vue";
import IconOpen from "~icons/lucide/git-pull-request";
import IconDraft from "~icons/lucide/git-pull-request-draft";
import IconClosed from "~icons/lucide/git-pull-request-closed";
import IconMerged from "~icons/lucide/git-merge";

/** Сайдбар-блок pull requests: состояние, список и подгрузка следующих страниц. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [pull: { number: number; title: string }, pinned?: boolean];
}>();
const list = usePagedList<PullRequest>(
  () => props.projectId,
  "pulls",
  "pulls",
  "Не удалось прочитать pull requests",
);
const { commands, open } = useTrackerPanel({
  kind: "pulls",
  plural: "pull requests",
  singular: "pull request",
  opens: "описание, ревью, обсуждение и изменённые файлы",
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (pull, pinned) => emit("open", pull, pinned),
});
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
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <TrackerPanel
    title="Pull requests"
    noun="pull requests"
    prefix="ide.pulls"
    :open="open"
    :count="list.items.value.length"
    :state="list.state.value"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    @toggle="commands.run('ide.pulls.block.toggle')"
    @filter="commands.run('ide.pulls.filter', { state: $event })"
    @more="commands.run('ide.pulls.more')"
  >
    <li v-for="pull in list.items.value" :key="pull.number">
      <TrackerRow
        :number="pull.number"
        :title="pull.title"
        :labels="pull.labels"
        :author="pull.author"
        @click="commands.run('ide.pulls.open', { number: pull.number, title: pull.title })"
        @dblclick="
          commands.run('ide.pulls.open', { number: pull.number, title: pull.title, pinned: true })
        "
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
          <span class="branches" :title="`${pull.head} → ${pull.base}`">
            {{ pull.head }} → {{ pull.base }}
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
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono);
}
</style>
