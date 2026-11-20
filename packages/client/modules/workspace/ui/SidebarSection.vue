<script setup lang="ts">
import { computed, provide, watch } from "vue";
import { sectionRefreshKey } from "../../../common/ui/UiSectionRefresh.vue";
import type { SidebarType } from "../../workspace-api/index.ts";
import type { SidebarHost, SidebarView } from "../lib/sidebar-views.ts";

const props = defineProps<{
  type: SidebarType;
  view: SidebarView;
  host: SidebarHost;
  selected: boolean;
  refreshing: boolean;
  refreshCommand: string;
}>();
const emit = defineEmits<{ panel: [panel: unknown]; refresh: [] }>();
provide(sectionRefreshKey, {
  refreshing: computed(() => props.refreshing),
  command: computed(() => props.refreshCommand),
  run: () => emit("refresh"),
});
watch(
  () => props.selected,
  (selected) => {
    if (selected) props.view.activate?.(props.host);
  },
  { immediate: true },
);
</script>

<template>
  <component
    :is="view.component"
    v-show="selected"
    :ref="(panel: unknown) => emit('panel', panel)"
    v-bind="view.props(host, selected, type)"
  />
</template>
