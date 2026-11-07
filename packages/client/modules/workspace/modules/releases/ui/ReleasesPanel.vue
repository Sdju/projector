<script setup lang="ts">
import UiEmpty from "../../../../../common/ui/UiEmpty.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiScrollArea from "../../../../../common/ui/UiScrollArea.vue";
import type { Release } from "@projector/core/modules/workspace/index.ts";
import { useReleases } from "../lib/releases.ts";
import { useReleasesPanel } from "../lib/release-panel.ts";
import ReleaseRow from "./ReleaseRow.vue";
import IconChevronRight from "~icons/lucide/chevron-right";

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
  <UiScrollArea class="side-content release-panel">
    <button
      class="block-toggle"
      type="button"
      :aria-expanded="open"
      data-command="ide.releases.block.toggle"
      @click="run('block.toggle')"
    >
      <IconChevronRight class="chevron" :class="{ open }" aria-hidden="true" />
      <h3>
        Releases
        <span v-if="list.items.value.length" class="count">{{ list.items.value.length }}</span>
      </h3>
    </button>
    <UiScrollArea v-show="open" class="block-body">
      <UiMessage v-if="list.loading.value" variant="note" tone="muted" role="status"
        >загрузка: релизы…</UiMessage
      >
      <UiMessage v-else-if="list.error.value" variant="note" tone="danger" role="alert">{{
        list.error.value
      }}</UiMessage>
      <UiEmpty v-else-if="!list.items.value.length" density="compact" align="start"
        >Нет релизов</UiEmpty
      >
      <ul v-else class="release-list">
        <li v-for="release in list.items.value" :key="release.id">
          <ReleaseRow
            :release="release"
            :latest="release.tag === list.latestTag.value"
            @click="openRelease(release)"
            @dblclick="openRelease(release, true)"
          />
        </li>
      </ul>
      <button
        v-if="list.next.value !== null && !list.loading.value"
        type="button"
        class="more"
        :disabled="list.loadingMore.value"
        @click="run('more')"
      >
        {{ list.loadingMore.value ? "загрузка…" : "Показать ещё" }}
      </button>
    </UiScrollArea>
  </UiScrollArea>
</template>

<style scoped>
.release-panel {
  display: flex;
  flex-direction: column;
}
.block-toggle {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  text-align: left;
  color: var(--muted);
}
.block-toggle h3 {
  margin: 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.chevron {
  width: 12px;
  height: 12px;
  transition: transform var(--t-fast);
}
.chevron.open {
  transform: rotate(90deg);
}
.count {
  margin-left: var(--sp-1);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.block-body {
  min-height: 0;
}
.release-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.more {
  width: 100%;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  text-align: left;
  border-top: 1px solid var(--line);
}
.more:hover:not(:disabled) {
  background: var(--active);
  color: var(--text);
}
</style>
