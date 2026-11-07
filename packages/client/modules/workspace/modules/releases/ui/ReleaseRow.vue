<script setup lang="ts">
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import type { Release } from "@projector/core/modules/workspace/index.ts";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { downloadsLabel } from "../../../../../common/utilities/release-format.ts";

/** A release row: tag, name, badges and the metadata the host reports. */
defineProps<{ release: Release; latest?: boolean }>();
</script>

<template>
  <button type="button" class="release-row" :title="release.name || release.tag">
    <UiInline as="span" class="title" :gap="1" align="normal" justify="normal">
      <span class="tag mono">{{ release.tag || "release" }}</span>
      <UiBadge v-if="latest" tone="info" shrink>последний</UiBadge>
      <UiBadge v-if="release.prerelease" tone="warning" shrink>пререлиз</UiBadge>
      <UiBadge v-if="release.draft" shrink>черновик</UiBadge>
      <UiBadge v-if="release.upcoming" tone="warning" shrink>скоро</UiBadge>
    </UiInline>
    <UiInline as="span" class="meta" wrap justify="normal">
      <span v-if="release.name && release.name !== release.tag" class="name">{{
        release.name
      }}</span>
      <span v-if="release.releasedAt" :title="release.releasedAt">{{
        relativeTime(release.releasedAt)
      }}</span>
      <span v-if="release.assetCount">{{
        countRu(release.assetCount, "файл", "файла", "файлов")
      }}</span>
      <span v-if="release.downloads">{{ downloadsLabel(release.downloads) }}</span>
    </UiInline>
  </button>
</template>

<style scoped>
.release-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--text-2);
  border-top: 1px solid var(--line);
}
.release-row:hover {
  background: var(--active);
  color: var(--text);
}
.title {
  font-size: var(--fs-xs);
  line-height: 1.35;
}
.tag {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--mono);
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
</style>
