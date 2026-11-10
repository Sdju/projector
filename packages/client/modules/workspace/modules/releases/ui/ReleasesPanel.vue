<script setup lang="ts">
import UiListSection from "../../../../../common/ui/UiListSection.vue";
import type { Release } from "@ai-projector/core/modules/workspace/index.ts";
import { useReleases } from "../lib/releases.ts";
import { useReleasesPanel } from "../lib/release-panel.ts";
import ReleaseRow from "./ReleaseRow.vue";

/** Sidebar release section: newest releases and the next pages. */
const props = defineProps<{ projectId: string; active: boolean }>();
const emit = defineEmits<{
  open: [release: { tag: string; title?: string }, pinned?: boolean];
}>();
const list = useReleases(() => props.projectId);
const { commands, open } = useReleasesPanel({
  projectId: () => props.projectId,
  active: () => props.active,
  list,
  open: (release, pinned) => emit("open", release, pinned),
});
const run = (action: string, args?: unknown) => commands.run(`ide.releases.${action}`, args);
const openRelease = (release: Release, pinned = false) =>
  run("open", {
    tag: release.tag,
    title: release.name || release.tag,
    pinned,
  });
defineExpose({ refresh: () => list.load() });
</script>

<template>
  <UiListSection
    class="release-panel"
    title="Releases"
    :count="list.items.value.length"
    :open="open"
    :loading="list.loading.value"
    :loading-more="list.loadingMore.value"
    :error="list.error.value"
    :has-more="list.next.value !== null"
    noun="релизы"
    toggle-command="ide.releases.block.toggle"
    @toggle="run('block.toggle')"
    @more="run('more')"
  >
    <li v-for="release in list.items.value" :key="release.id">
      <ReleaseRow
        :release="release"
        :latest="release.tag === list.latestTag.value"
        @click="openRelease(release)"
        @dblclick="openRelease(release, true)"
      />
    </li>
  </UiListSection>
</template>
