<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import type { IssueLabel, IssueUser, Reaction } from "@projector/core/modules/workspace/index.ts";
import { absoluteTime, relativeTime } from "../../../../../common/utilities/commit-format.ts";
import TrackerAuthor from "./TrackerAuthor.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import TrackerReactions from "./TrackerReactions.vue";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
import IconExternal from "~icons/lucide/external-link";

/**
 * Каркас вкладки issue / pull request: состояние, заголовок, автор, метки и Markdown-тело;
 * разделы вкладки (ревью, файлы, комментарии) приходят слотом.
 */
withDefaults(
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
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <UiViewerPage>
    <UiHint size="xs" leading="inherit" :space-before="2" v-if="loading" class="note" role="status"
      >загрузка: {{ noun }}…</UiHint
    >
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
      <UiInline as="header" class="head" align="baseline" wrap justify="normal">
        <span class="state" :class="state">{{ stateLabel }}</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">
          <EmojiText :text="title" /> <span class="number">#{{ number }}</span>
        </UiHeading>
      </UiInline>
      <UiInline as="p" class="meta" wrap>
        <TrackerAuthor :author="author" :size="18" />
        <slot name="meta" />
        <span :title="absoluteTime(createdAt)">открыт {{ relativeTime(createdAt) }}</span>
        <UiInline
          as="a"
          inline
          :gap="1"
          justify="normal"
          v-if="htmlUrl"
          class="external"
          :href="htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на {{ host }}
        </UiInline>
      </UiInline>
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
.state {
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--active);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state.open {
  background: color-mix(in srgb, var(--run) 22%, transparent);
  color: var(--run);
}
.state.merged,
.state.answered {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.number {
  color: var(--muted);
  font: var(--fs-xs) var(--mono);
}
.meta {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.external {
  color: var(--text-2);
}
.external svg {
  width: 13px;
  height: 13px;
}
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
.note.error {
  color: var(--err);
}
</style>
