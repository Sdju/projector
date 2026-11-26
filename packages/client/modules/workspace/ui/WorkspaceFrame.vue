<script setup lang="ts">
import { ref, type StyleValue } from "vue";
import UiResizeHandle from "../../../common/ui/UiResizeHandle.vue";
import type { MobileSurface } from "../lib/mobile-surfaces.ts";

defineProps<{
  sidebarInvisible: boolean;
  asideShown: boolean;
  asideHidden: boolean;
  asideBottom: boolean;
  zen: boolean;
  mobile: boolean;
  mobileSurface: MobileSurface;
  mobileSidebarOpen: boolean;
  sizes: StyleValue;
}>();
const emit = defineEmits<{
  treePointer: [event: PointerEvent];
  treeKey: [event: KeyboardEvent];
  asidePointer: [event: PointerEvent];
  asideKey: [event: KeyboardEvent];
  closeSidebar: [];
}>();
const element = ref<HTMLElement>();
defineExpose({ element });
</script>

<template>
  <div
    ref="element"
    class="workspace"
    :class="{
      'sidebar-hidden': sidebarInvisible,
      'has-aside': asideShown,
      'aside-hidden': asideHidden,
      'aside-bottom': asideShown && asideBottom,
      zen,
    }"
    :data-surface="mobile ? mobileSurface : undefined"
    :style="sizes"
  >
    <div class="toolbar-host"><slot name="toolbar" /></div>
    <Transition name="mobile-left"><slot name="sidebar" /></Transition>
    <UiResizeHandle
      appearance="gap"
      orientation="vertical"
      v-show="!sidebarInvisible"
      class="resize-handle tree-resize"
      aria-label="Ширина дерева файлов"
      tabindex="0"
      @pointerdown="emit('treePointer', $event)"
      @keydown="emit('treeKey', $event)"
    />
    <button
      v-if="mobile && mobileSidebarOpen"
      class="sidebar-backdrop"
      aria-label="Закрыть боковую панель"
      data-command="ide.workbench.sidebar.toggle"
      @click="emit('closeSidebar')"
    />
    <slot v-if="asideShown" name="aside" />
    <slot name="dock" />
    <UiResizeHandle
      v-if="asideShown && !asideHidden && !asideBottom"
      appearance="gap"
      orientation="vertical"
      class="resize-handle aside-resize"
      aria-label="Ширина правой панели"
      tabindex="0"
      @pointerdown="emit('asidePointer', $event)"
      @keydown="emit('asideKey', $event)"
    />
    <slot />
  </div>
</template>

<style scoped>
.workspace {
  --rail-w: 40px;
  --aside-width: clamp(240px, 21vw, 320px);
  display: grid;
  grid-template-columns: var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(
      0,
      1fr
    );
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
/* Панель свёрнута, полоса разделов остаётся */
.workspace.sidebar-hidden {
  grid-template-columns: calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr);
  column-gap: 0;
}
/* Правая полоса разделов: её колонка остаётся, даже когда панель свёрнута. */
.workspace.has-aside {
  grid-template-columns:
    var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(0, 1fr)
    var(--island-gap) var(--aside-width);
}
.workspace.sidebar-hidden.has-aside {
  grid-template-columns:
    calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
    var(--aside-width);
}
.workspace.has-aside.aside-hidden {
  grid-template-columns:
    var(--tree-width, clamp(240px, 21vw, 320px)) var(--island-gap) minmax(0, 1fr)
    var(--island-gap) calc(var(--rail-w) - var(--island-gap));
}
.workspace.sidebar-hidden.has-aside.aside-hidden {
  grid-template-columns:
    calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
    calc(var(--rail-w) - var(--island-gap));
}
.workspace > :deep(.aside) {
  grid-column: 5;
  grid-row: 3;
}
.tree-resize {
  grid-column: 2;
  grid-row: 3;
}
.aside-resize {
  grid-column: 4;
  grid-row: 3;
}
.workspace > :deep(.dock-pane) {
  position: relative;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  grid-column: 3;
  grid-row: 3;
}
@media (max-width: 1050px) and (min-width: 701px) {
  .workspace > :deep(.dock-pane) {
    overflow: auto;
  }
  .workspace {
    --aside-width: clamp(200px, 24vw, 260px);
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr);
  }
  .workspace.sidebar-hidden {
    grid-template-columns: calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr);
  }
  .workspace.has-aside {
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr) var(--island-gap) var(
        --aside-width
      );
  }
  .workspace.has-aside.aside-bottom {
    grid-template-columns: 260px var(--island-gap) minmax(0, 1fr);
    grid-template-rows: auto auto minmax(0, 1fr) minmax(180px, 34vh) auto;
  }
  .workspace.has-aside.aside-bottom > :deep(.aside) {
    grid-column: 3;
    grid-row: 4;
  }
  .workspace.has-aside.aside-bottom > :deep(.sidebar:not(.aside)),
  .workspace.has-aside.aside-bottom > .tree-resize {
    grid-row: 3 / 5;
  }
  .workspace.has-aside.aside-bottom > :deep(.workspace-status) {
    grid-row: 5;
  }
  .workspace.sidebar-hidden.has-aside {
    grid-template-columns:
      calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
      var(--aside-width);
  }
  .workspace.has-aside.aside-hidden {
    grid-template-columns:
      260px var(--island-gap) minmax(0, 1fr) var(--island-gap)
      calc(var(--rail-w) - var(--island-gap));
  }
  .workspace.sidebar-hidden.has-aside.aside-hidden {
    grid-template-columns:
      calc(var(--rail-w) - var(--island-gap)) var(--island-gap) minmax(0, 1fr) var(--island-gap)
      calc(var(--rail-w) - var(--island-gap));
  }
}
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .workspace,
  .workspace.sidebar-hidden {
    position: relative;
    grid-template-columns: minmax(0, 1fr);
    flex: 1;
    height: 100%;
    min-height: 0;
    padding: 0;
    background: none;
    border-radius: 0;
  }
  .tree-resize {
    display: none;
  }
  .aside-resize {
    display: none;
  }
  .workspace > :deep(.dock-pane) {
    grid-column: 1;
    grid-row: 3;
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    background: var(--theme-panel-background, var(--bg));
  }
  .workspace > :deep(.mobile-left-enter-active),
  .workspace > :deep(.mobile-left-leave-active) {
    transition: transform var(--t-base);
  }
  .workspace > :deep(.mobile-left-enter-from),
  .workspace > :deep(.mobile-left-leave-to) {
    transform: translateX(-100%);
  }
  .sidebar-backdrop {
    display: none;
  }
}
.toolbar-host {
  grid-column: 1 / -1;
}
/* Полоса действий вынесена в шапку (Teleport), здесь остаётся только якорь */
.toolbar-host {
  display: none;
}
.workspace > :deep(.workspace-status) {
  grid-column: 1 / -1;
  grid-row: 4;
  margin-top: var(--island-gap);
}
.workspace.zen,
.workspace.zen.sidebar-hidden,
.workspace.zen.has-aside,
.workspace.zen.sidebar-hidden.has-aside,
.workspace.zen.has-aside.aside-hidden,
.workspace.zen.sidebar-hidden.has-aside.aside-hidden {
  position: relative;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  column-gap: 0;
}
.workspace.zen > :deep(.sidebar),
.workspace.zen > :deep(.aside),
.workspace.zen > .aside-resize,
.workspace.zen > .tree-resize,
.workspace.zen > .sidebar-backdrop,
.workspace.zen > :deep(.workspace-status),
.workspace.zen > :deep(.mobile-surfaces) {
  display: none;
}
.workspace.zen > :deep(.dock-pane) {
  grid-column: 1;
  grid-row: 1;
  overflow: hidden;
  border: 0;
  border-radius: 0;
}
.workspace > :deep(.zen-exit) {
  position: absolute;
  top: max(var(--sp-2), env(safe-area-inset-top));
  right: max(var(--sp-2), env(safe-area-inset-right));
  z-index: var(--z-expanded);
  border: 1px solid var(--line);
  background: var(--bg-2);
  box-shadow: var(--shadow-popover);
  opacity: 0.45;
  transition:
    opacity var(--t-fast),
    background var(--t-fast),
    color var(--t-fast);
}
.workspace > :deep(.zen-exit:hover),
.workspace > :deep(.zen-exit:focus-visible) {
  opacity: 1;
  background: var(--bg-3);
  color: var(--text);
}
</style>
