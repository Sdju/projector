<script setup lang="ts">
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import type { Discussion } from "../../../../../../core/modules/workspace/index.ts";
import { usePagedList } from "../lib/paged-list.ts";
import { useTrackerPanel } from "../lib/tracker-panel.ts";
import TrackerPanel from "./TrackerPanel.vue";
import TrackerRow from "./TrackerRow.vue";
import IconAnswered from "~icons/lucide/circle-check";
import IconComment from "~icons/lucide/message-square";

/** Сайдбар-блок discussions: состояние, список и подгрузка следующих страниц по курсору. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [discussion: { number: number; title: string }, pinned?: boolean];
}>();
const list = usePagedList<Discussion>(
  () => props.projectId,
  "discussions",
  "discussions",
  "Не удалось прочитать discussions",
);
const { commands, open } = useTrackerPanel({
  kind: "discussions",
  plural: "discussions",
  singular: "discussion",
  opens: "описание, комментарии и ответы",
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (discussion, pinned) => emit("open", discussion, pinned),
});
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <TrackerPanel
    title="Discussions"
    noun="discussions"
    prefix="ide.discussions"
    :open="open"
    :count="list.items.value.length"
    :state="list.state.value"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    @toggle="commands.run('ide.discussions.block.toggle')"
    @filter="commands.run('ide.discussions.filter', { state: $event })"
    @more="commands.run('ide.discussions.more')"
  >
    <li v-for="discussion in list.items.value" :key="discussion.number">
      <TrackerRow
        :number="discussion.number"
        :title="discussion.title"
        :labels="discussion.labels"
        :author="discussion.author"
        @click="
          commands.run('ide.discussions.open', {
            number: discussion.number,
            title: discussion.title,
          })
        "
        @dblclick="
          commands.run('ide.discussions.open', {
            number: discussion.number,
            title: discussion.title,
            pinned: true,
          })
        "
      >
        <template #icon>
          <IconAnswered
            v-if="discussion.answered"
            class="answered"
            title="Есть ответ"
            aria-hidden="true"
          />
        </template>
        <template #meta>
          <span v-if="discussion.category.name" class="category"
            ><EmojiText :text="discussion.category.emoji" /> {{ discussion.category.name }}</span
          >
          <span
            v-if="discussion.comments"
            class="comments"
            :title="`${discussion.comments} комментариев`"
          >
            <IconComment aria-hidden="true" />{{ discussion.comments }}
          </span>
        </template>
      </TrackerRow>
    </li>
  </TrackerPanel>
</template>

<style scoped>
.answered {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin-top: 1px;
  color: var(--run);
}
.category {
  color: var(--text-2);
}
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
