<script setup lang="ts">
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiListRow from "../../../../../common/ui/UiListRow.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";
import type { IssueLabel, IssueUser } from "@ai-projector/core/modules/workspace/index.ts";
import EmojiText from "../../../../../common/ui/EmojiText.vue";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";

/** Строка списка (issue, pull request); клики и двойные клики обрабатывает родитель. */
defineProps<{ number: number; title: string; labels: IssueLabel[]; author: IssueUser }>();
const labelDot = (label: IssueLabel) => (label.color ? `#${label.color}` : "transparent");
</script>

<template>
  <UiListRow>
    <template #title>
      <slot name="icon" /><span><EmojiText :text="title" /></span>
    </template>
    <template #meta>
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
    </template>
  </UiListRow>
</template>

<style scoped>
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
