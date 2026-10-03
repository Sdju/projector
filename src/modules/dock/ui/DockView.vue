<script setup lang="ts">
import { computed, provide, useSlots, type Slots } from "vue";
import { useEventListener } from "@vueuse/core";
import { tabDrag } from "../../../common/utilities/tab-drag.ts";
import type { ContextMenuItem } from "../../../common/ui/context-menu.ts";
import { isNodeVisible, type DockLayout, type DockTarget } from "../model/layout.ts";
import { dockKey, type DockTabInfo } from "./context.ts";
import DockTree from "./DockTree.vue";
import MobileDock from "./MobileDock.vue";

/**
 * Раскладка блоков: разделители, группы вкладок, перетаскивание и изменение размеров.
 * Содержимое панелей и действия вкладок задаёт владелец через слоты и обработчики.
 */
const props = defineProps<{
  layout: DockLayout;
  mobile?: boolean;
  mobileSurface?: "editor" | "files" | "terminal";
  terminalPanel?: (id: string) => boolean;
  describe: (id: string) => DockTabInfo;
  projectId: string;
  commandNamespace: string;
  tabActions?: (id: string) => ContextMenuItem[];
  /** Принимает ли блок внешнее перетаскивание (файлы из дерева или с рабочего стола). */
  acceptsDrop?: (data: DataTransfer | null) => boolean;
}>();
const emit = defineEmits<{
  "update:layout": [layout: DockLayout];
  select: [id: string];
  close: [id: string];
  closeMany: [ids: string[]];
  rename: [id: string, label: string];
  pin: [id: string];
  drop: [event: DragEvent, target: DockTarget];
}>();
const slots: Slots = useSlots();
provide(dockKey, {
  layout: () => props.layout,
  slots,
  get projectId() {
    return props.projectId;
  },
  get commandNamespace() {
    return props.commandNamespace;
  },
  describe: (id) => props.describe(id),
  tabActions: (id) => props.tabActions?.(id) ?? [],
  acceptsDrop: (data) => props.acceptsDrop?.(data) ?? false,
  update: (layout) => emit("update:layout", layout),
  select: (id) => emit("select", id),
  close: (id) => emit("close", id),
  closeMany: (ids) => emit("closeMany", ids),
  rename: (id, label) => emit("rename", id, label),
  pin: (id) => emit("pin", id),
  drop: (event, target) => emit("drop", event, target),
});
const visible = computed(() => isNodeVisible(props.layout.root));
// A drop elsewhere on the page, or a cancelled drag, must not leave group drop zones armed.
useEventListener(window, "dragend", () => (tabDrag.value = undefined));
useEventListener(window, "drop", () => (tabDrag.value = undefined));
</script>

<template>
  <div class="dock" :class="{ 'mobile': mobile }">
    <MobileDock v-if="mobile && terminalPanel" :surface="mobileSurface ?? 'editor'" :terminal-panel="terminalPanel" />
    <DockTree v-else-if="visible" :node="layout.root" />
    <p v-else class="dock-none">Все блоки скрыты. Включите нужный блок на панели выше.</p>
  </div>
</template>

<style scoped>
.dock {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.dock-none {
  margin: auto;
  color: var(--muted);
  font-size: var(--fs-sm);
}
@media (max-width: 1050px) {
  .dock {
    min-height: 100%;
    height: auto;
  }
}
.dock.mobile { height: 100%; min-height: 0; }
</style>
