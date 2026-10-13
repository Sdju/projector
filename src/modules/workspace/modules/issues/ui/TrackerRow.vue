<script setup lang="ts">
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import type { IssueLabel, IssueUser } from "../../../../../../core/modules/workspace/index.ts";
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";

/** Строка списка (issue, pull request); клики и двойные клики обрабатывает родитель. */
defineProps<{ number: number; title: string; labels: IssueLabel[]; author: IssueUser }>();
const labelDot = (label: IssueLabel) => (label.color ? `#${label.color}` : "transparent");
</script>

<template>
  <button type="button" class="tracker-row">
    <UiInline as="span" class="title" :gap="1" align="normal" justify="normal"
      ><slot name="icon" /><span><EmojiText :text="title" /></span
    ></UiInline>
    <UiInline as="span" class="meta" wrap justify="normal">
      <span class="number">#{{ number }}</span>
      <UiInline
        as="span"
        inline
        :gap="1"
        justify="normal"
        v-for="label in labels.slice(0, 3)"
        :key="label.name"
        class="label"
      >
        <UiStatusDot class="dot" shrink :style="{ background: labelDot(label) }" />
        <EmojiText :text="label.name" />
      </UiInline>
      <UiInline as="span" inline :gap="1" justify="normal" class="author">
        <UiAvatar :src="author.avatarUrl" :alt="author.login" :size="14" />
        {{ author.login }}
      </UiInline>
      <slot name="meta" />
    </UiInline>
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
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.meta {
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
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
}
</style>
