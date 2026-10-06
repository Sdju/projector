<script setup lang="ts">
import IconComment from "~icons/lucide/message-square";
import { useIssues } from "../lib/issues.ts";
import { useTrackerPanel } from "../lib/tracker-panel.ts";
import TrackerPanel from "./TrackerPanel.vue";
import TrackerRow from "./TrackerRow.vue";

/** Сайдбар-блок issues: состояние, список и подгрузка следующих страниц. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [issue: { number: number; title: string }, pinned?: boolean];
}>();
const list = useIssues(() => props.projectId);
const { commands, open } = useTrackerPanel({
  kind: "issues",
  plural: "issues",
  singular: "issue",
  opens: "обсуждение",
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (issue, pinned) => emit("open", issue, pinned),
});
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <TrackerPanel
    title="Issues"
    noun="issues"
    prefix="ide.issues"
    :open="open"
    :count="list.items.value.length"
    :state="list.state.value"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    @toggle="commands.run('ide.issues.block.toggle')"
    @filter="commands.run('ide.issues.filter', { state: $event })"
    @more="commands.run('ide.issues.more')"
  >
    <li v-for="issue in list.items.value" :key="issue.number">
      <TrackerRow
        :number="issue.number"
        :title="issue.title"
        :labels="issue.labels"
        :author="issue.author"
        @click="commands.run('ide.issues.open', { number: issue.number, title: issue.title })"
        @dblclick="
          commands.run('ide.issues.open', {
            number: issue.number,
            title: issue.title,
            pinned: true,
          })
        "
      >
        <template #meta>
          <span v-if="issue.comments" class="comments" :title="`${issue.comments} комментариев`">
            <IconComment aria-hidden="true" />{{ issue.comments }}
          </span>
        </template>
      </TrackerRow>
    </li>
  </TrackerPanel>
</template>

<style scoped>
.comments {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.comments svg {
  width: 12px;
  height: 12px;
}
</style>
