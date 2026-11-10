<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiDetailHeader from "../../../../../common/ui/UiDetailHeader.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import type {
  IssueLabel,
  IssueUser,
  Reaction,
} from "@ai-projector/core/modules/workspace/index.ts";
import { computed } from "vue";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import TrackerAuthor from "./TrackerAuthor.vue";
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import TrackerReactions from "./TrackerReactions.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";

/**
 * Каркас вкладки issue / pull request: состояние, заголовок, автор, метки и Markdown-тело;
 * разделы вкладки (ревью, файлы, комментарии) приходят слотом.
 */
const props = withDefaults(
  defineProps<{
    projectId: string;
    loading: boolean;
    error: string;
    /** Загрузка идёт, данных ещё нет. */
    ready: boolean;
    noun: string;
    state: string;
    stateLabel: string;
    title: string;
    number: number;
    author: IssueUser;
    createdAt: string;
    htmlUrl: string;
    labels: IssueLabel[];
    body: string;
    reactions: Reaction[];
    /** Хост в ссылке «на …»: «GitHub» или «GitLab». */
    host?: string;
  }>(),
  { host: "GitHub" },
);
const stateTone = computed(() => {
  if (props.state === "open") return "success" as const;
  if (props.state === "merged" || props.state === "answered") return "accent" as const;
  return "neutral" as const;
});
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <UiViewerPage>
    <UiLoader v-if="loading" class="note">загрузка: {{ noun }}…</UiLoader>
    <UiHint
      size="xs"
      leading="inherit"
      :space-before="2"
      v-else-if="error"
      class="note error"
      role="alert"
      >{{ error }}</UiHint
    >
    <UiArticle v-else-if="ready">
      <UiDetailHeader
        :state="stateLabel"
        :tone="stateTone"
        :number="number"
        :external-href="htmlUrl"
        :host="host"
      >
        <template #title><EmojiText :text="title" /></template>
        <template #meta>
          <TrackerAuthor :author="author" :size="18" />
          <slot name="meta" />
          <span :title="absoluteTime(createdAt)">открыт {{ relativeTime(createdAt) }}</span>
        </template>
      </UiDetailHeader>
      <slot name="stats" />
      <slot name="summary" />
      <ul v-if="labels.length" class="labels">
        <li
          v-for="label in labels"
          :key="label.name"
          :style="{ borderColor: label.color ? `#${label.color}` : undefined }"
        >
          <EmojiText :text="label.name" />
        </li>
      </ul>
      <VisualMarkdownEditor
        v-if="body"
        class="body"
        :content="body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
        @open="emit('open', $event)"
      />
      <UiHint size="xs" leading="inherit" :space-before="2" v-else class="note"
        >Без описания</UiHint
      >
      <TrackerReactions :reactions="reactions" />
      <slot />
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.labels {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  list-style: none;
  margin: var(--sp-3) 0 0;
  padding: 0;
}
.labels li {
  padding: 1px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.body {
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
</style>
