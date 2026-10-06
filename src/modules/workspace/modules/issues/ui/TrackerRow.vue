<script setup lang="ts">
import type { IssueLabel, IssueUser } from "../../../../../../core/modules/workspace/index.ts";
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";

/** Строка списка (issue, pull request); клики и двойные клики обрабатывает родитель. */
defineProps<{ number: number; title: string; labels: IssueLabel[]; author: IssueUser }>();
const labelDot = (label: IssueLabel) => (label.color ? `#${label.color}` : "transparent");
</script>

<template>
  <button type="button" class="tracker-row">
    <span class="title"
      ><slot name="icon" /><span><EmojiText :text="title" /></span
    ></span>
    <span class="meta">
      <span class="number">#{{ number }}</span>
      <span v-for="label in labels.slice(0, 3)" :key="label.name" class="label">
        <span class="dot" :style="{ background: labelDot(label) }" />
        {{ label.name }}
      </span>
      <span class="author">
        <UiAvatar :src="author.avatarUrl" :alt="author.login" :size="14" />
        {{ author.login }}
      </span>
      <slot name="meta" />
    </span>
  </button>
</template>

<style scoped>
.tracker-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.tracker-row:hover {
  background: var(--active);
  color: var(--text);
}
.title {
  display: flex;
  gap: var(--sp-1);
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.number,
.author {
  font-family: var(--mono);
}
.author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: var(--r-full);
}
</style>
