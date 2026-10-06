<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import DockTabs from "./DockTabs.vue";
import DockSlot from "./DockSlot.ts";
import { dockKey } from "./context.ts";
import { mobileDockSurfaces } from "../model/mobile-surfaces.ts";

const props = defineProps<{
  surface: "editor" | "files" | "terminal";
  terminalPanel: (id: string) => boolean;
}>();
const dock = inject(dockKey)!;
const terminalOpen = computed(() => props.surface === "terminal");
const terminalFocused = ref(props.surface === "terminal");
watch(
  () => props.surface,
  () => {
    terminalFocused.value = false;
  },
);
const last = ref({ editor: "", terminal: "" });
const order = ref({ editor: [] as string[], terminal: [] as string[] });
const surfaces = computed(() =>
  mobileDockSurfaces(dock.layout(), props.terminalPanel, last.value, order.value).map(
    (surface) => ({ ...surface, tabs: surface.ids.map(dock.describe) }),
  ),
);
watch(
  surfaces,
  (value) => {
    for (const surface of value) if (surface.active) last.value[surface.side] = surface.active;
  },
  { immediate: true },
);
watch(
  () => props.surface,
  (side) => {
    if (side === "files") return;
    const surface = surfaces.value.find((item) => item.side === side);
    if (surface?.active) dock.select(surface.active);
  },
  { flush: "post" },
);
const handlers = {
  select: dock.select,
  close: dock.close,
  closeMany: dock.closeMany,
  rename: dock.rename,
  pin: dock.pin,
  reorder: (ids: string[]) => {
    const side = ids[0] && props.terminalPanel(ids[0]) ? "terminal" : "editor";
    order.value[side] = ids;
  },
};
</script>

<template>
  <div class="mobile-dock">
    <Transition
      v-for="surface in surfaces"
      :key="surface.side"
      name="mobile-right"
      @after-enter="terminalFocused = terminalOpen"
    >
      <section
        class="surface"
        :class="surface.side"
        v-show="surface.side === 'editor' || terminalOpen"
        :inert="surface.side === 'editor' && terminalOpen"
        :aria-label="surface.side === 'editor' ? 'Редактор' : 'Терминалы'"
      >
        <header v-if="surface.tabs.length || surface.side === 'terminal'" class="tabs">
          <DockSlot
            v-if="dock.slots.leading"
            :render="dock.slots.leading"
            :args="{ group: { role: surface.side } }"
          />
          <DockTabs
            :tabs="surface.tabs"
            :active-id="surface.active"
            :label="surface.side === 'editor' ? 'Файлы' : 'Терминалы'"
            :project-id="dock.projectId"
            :command-namespace="dock.commandNamespace"
            :command-handlers="handlers"
            :actions="dock.tabActions"
            close-saved
          >
            <template #icon="{ tab }"
              ><DockSlot v-if="dock.slots.icon" :render="dock.slots.icon" :args="{ tab }"
            /></template>
          </DockTabs>
          <DockSlot
            v-if="surface.side === 'terminal' && dock.slots.actions"
            :render="dock.slots.actions"
            :args="{ activeId: surface.active }"
          />
        </header>
        <div class="body">
          <div
            v-for="id in surface.ids.filter((id) => id === surface.active)"
            :key="id"
            class="panel"
            :data-panel="id"
          >
            <DockSlot
              v-if="dock.slots.panel"
              :render="dock.slots.panel"
              :args="{
                id,
                focused: surface.side === 'terminal' ? terminalFocused : props.surface === 'editor',
              }"
            />
          </div>
          <div v-if="!surface.ids.length" class="empty">
            <DockSlot
              v-if="dock.slots.empty"
              :render="dock.slots.empty"
              :args="{ group: { role: surface.side } }"
            />
          </div>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.mobile-dock {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.surface {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  min-height: 0;
}
.terminal {
  z-index: 2;
}
.tabs {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: none;
  height: 36px;
  background: var(--bg-sunken);
}
.tabs :deep(.workspace-tabs) {
  flex: 1;
  min-width: 0;
  height: 36px;
}
.body {
  position: relative;
  flex: 1;
  min-height: 0;
}
.panel {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.empty {
  height: 100%;
  display: grid;
  place-items: center;
  padding: var(--sp-4);
  text-align: center;
}
.mobile-right-enter-active,
.mobile-right-leave-active {
  transition: transform var(--t-base);
}
.mobile-right-enter-from,
.mobile-right-leave-to {
  transform: translateX(100%);
}
</style>
