<script setup lang="ts">
import UiInline from "../../../../../common/ui/UiInline.vue";
import type { IssueUser } from "../../../../../../core/modules/workspace/index.ts";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
defineProps<{ author: IssueUser; size: 16 | 18 }>();
</script>

<template>
  <UiInline as="span" inline :gap="1.25" justify="normal" class="author">
    <UiAvatar :src="author.avatarUrl" :alt="author.login" :size="size" />
    {{ author.login }}
  </UiInline>
</template>

<style scoped>
.author {
  font-family: var(--mono);
  color: var(--text-2);
}
</style>
