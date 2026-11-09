<script setup lang="ts">
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import UiListRow from "../../../../../common/ui/UiListRow.vue";
import type { Release } from "@projector/core/modules/workspace/index.ts";
import { relativeTime } from "../../../../../common/utilities/commit-format.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { downloadsLabel } from "../../../../../common/utilities/release-format.ts";

/** A release row: tag, name, badges and the metadata the host reports. */
defineProps<{ release: Release; latest?: boolean }>();
</script>

<template>
  <UiListRow :label="release.name || release.tag">
    <template #title>
      <span class="tag mono">{{ release.tag || "release" }}</span>
      <UiBadge v-if="latest" tone="info" shrink>последний</UiBadge>
      <UiBadge v-if="release.prerelease" tone="warning" shrink>пререлиз</UiBadge>
      <UiBadge v-if="release.draft" shrink>черновик</UiBadge>
      <UiBadge v-if="release.upcoming" tone="warning" shrink>скоро</UiBadge>
    </template>
    <template #meta>
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
    </template>
  </UiListRow>
</template>

<style scoped>
.tag,
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mono {
  font-family: var(--mono);
}
</style>
