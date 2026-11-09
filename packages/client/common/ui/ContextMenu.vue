<script setup lang="ts">
import UiPopupSurface from "./UiPopupSurface.vue";
import UiBadge from "./UiBadge.vue";
import UiActionRow from "./UiActionRow.vue";
import UiIsland from "./UiIsland.vue";
import UiIslandHeader from "./UiIslandHeader.vue";
import { nextTick, onBeforeUnmount, ref, useId, computed, watch } from "vue";
import { useCompactViewport } from "../utilities/compact-viewport.ts";
import { useIslandMenu } from "../utilities/island-menu.ts";
import type { ContextMenuItem } from "./context-menu.ts";

const props = defineProps<{ items: ContextMenuItem[]; label?: string }>();
const compact = useCompactViewport();
const island = useIslandMenu({
  anchor: "left",
  initialFocus: ".sheet-items button:not(:disabled)",
  items: ".sheet-items button",
});
const surface = ref<InstanceType<typeof UiPopupSurface>>();
const menu = computed(() => surface.value?.element);
const title = computed(() => props.label || "Действия");
const anchorName = `--context-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const point = ref({ x: 0, y: 0 });
let trigger: HTMLElement | undefined;
let restoreFocus = false;
let opening = 0;
let releaseListener: (() => void) | undefined;
function close(focus = true) {
  opening++;
  releaseListener?.();
  restoreFocus = focus;
  menu.value?.hidePopover();
  island.close(false);
  if (compact.value && focus && trigger?.isConnected) trigger.focus();
}
function waitForRelease(event: Event) {
  if (!(event instanceof MouseEvent)) return Promise.resolve();
  // Linux right-click and a touch long-press both fire contextmenu while the pointer is down.
  // Showing after release keeps popover light-dismiss and the island click-outside from eating it.
  const held = event.buttons !== 0 || (compact.value && Boolean(document.querySelector(":active")));
  if (!held) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (releaseListener !== finish) return;
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      releaseListener = undefined;
      setTimeout(resolve, 0);
    };
    releaseListener = finish;
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  });
}
async function open(event: MouseEvent | KeyboardEvent, source?: HTMLElement) {
  event.preventDefault();
  event.stopPropagation();
  restoreFocus = false;
  trigger = source ?? (event.currentTarget as HTMLElement);
  const bounds = trigger.getBoundingClientRect();
  trigger = trigger.querySelector<HTMLButtonElement>('[role="tab"]') ?? trigger;
  const pointer = event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0);
  point.value = {
    x: Math.max(4, Math.min(pointer ? event.clientX : bounds.left + 12, window.innerWidth - 4)),
    y: Math.max(4, Math.min(pointer ? event.clientY : bounds.bottom, window.innerHeight - 4)),
  };
  const generation = ++opening;
  await waitForRelease(event);
  await nextTick();
  if (generation !== opening) return;
  if (compact.value) {
    if (island.open.value) island.close(false);
    island.trigger.value = trigger;
    await island.toggle(true);
    return;
  }
  menu.value?.showPopover({ source: trigger });
  await nextTick();
  menu.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
function toggle(event: Event) {
  if ((event as ToggleEvent).newState === "closed") {
    if (restoreFocus && trigger?.isConnected) trigger.focus();
    restoreFocus = false;
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "Tab") {
    if (event.key === "Escape") event.preventDefault();
    close();
    return;
  }
  const buttons = [...menu.value!.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === "ArrowDown") next = (index + 1) % buttons.length;
  else if (event.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  else {
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const ordered = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)];
      ordered
        .find((button) =>
          button.textContent?.trim().toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()),
        )
        ?.focus();
    }
    return;
  }
  event.preventDefault();
  buttons[next]?.focus();
}
function activate(item: ContextMenuItem) {
  close(false);
  if (trigger?.isConnected) trigger.focus();
  void item.run();
}
function dismiss(event: Event) {
  if (compact.value) return;
  if (event.type === "scroll" && event.target instanceof Node && menu.value?.contains(event.target))
    return;
  close(false);
}
watch(compact, () => close(false));
window.addEventListener("resize", dismiss);
window.addEventListener("blur", dismiss);
window.addEventListener("scroll", dismiss, true);
onBeforeUnmount(() => {
  close(false);
  window.removeEventListener("resize", dismiss);
  window.removeEventListener("blur", dismiss);
  window.removeEventListener("scroll", dismiss, true);
});
function openForElement(element: HTMLElement) {
  return open(new KeyboardEvent("keydown"), element);
}
defineExpose({ open, openForElement, close });
function hintTone(tone: "spare" | "normal" | "hot" | "over" | null | undefined) {
  return tone === "spare"
    ? "info"
    : tone === "hot"
      ? "warning"
      : tone === "over"
        ? "danger"
        : "neutral";
}
</script>
<template>
  <UiIsland v-if="compact" :menu="island" :label="title" :width="320">
    <UiIslandHeader class="island-head" aria-label="Закрыть" @click="close()">{{
      title
    }}</UiIslandHeader>
    <div class="sheet-items" role="menu" :aria-label="title">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" role="separator" class="menu-separator" />
        <UiActionRow
          class="sheet-item"
          role="menuitem"
          justify="between"
          :disabled="item.disabled"
          :tone="item.danger ? 'danger' : undefined"
          :data-command="item.command"
          @click="activate(item)"
        >
          <span class="item-label"
            ><component :is="item.icon" v-if="item.icon" aria-hidden="true" />{{ item.label }}</span
          ><UiBadge v-if="item.hint" class="hint" mono shrink :tone="hintTone(item.hint.tone)">{{
            item.hint.text
          }}</UiBadge>
        </UiActionRow>
      </template>
    </div>
  </UiIsland>
  <Teleport v-else to="body">
    <span
      class="context-anchor"
      :style="{ left: `${point.x}px`, top: `${point.y}px`, anchorName }"
    />
    <UiPopupSurface
      ref="surface"
      border="strong"
      radius="md"
      surface="tertiary"
      popover="auto"
      role="menu"
      class="context-menu"
      :aria-label="title"
      :style="{ positionAnchor: anchorName }"
      @toggle="toggle"
      @keydown="keydown"
      @contextmenu.prevent.stop
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" role="separator" class="menu-separator" />
        <UiActionRow
          class="menu-item"
          role="menuitem"
          :data-command="item.command"
          :disabled="item.disabled"
          :tone="item.danger ? 'danger' : undefined"
          :gap="1.5"
          justify="between"
          @click="activate(item)"
        >
          <span class="item-label"
            ><component :is="item.icon" v-if="item.icon" aria-hidden="true" />{{ item.label }}</span
          ><UiBadge v-if="item.hint" class="hint" mono shrink :tone="hintTone(item.hint.tone)">{{
            item.hint.text
          }}</UiBadge
          ><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </UiActionRow>
      </template>
    </UiPopupSurface>
  </Teleport>
</template>
<style scoped>
.context-anchor {
  position: fixed;
  width: 0;
  height: 0;
  pointer-events: none;
}
.context-menu {
  position: fixed;
  position-area: bottom right;
  position-try-fallbacks:
    flip-block,
    flip-inline,
    flip-block flip-inline;
  margin: var(--sp-1);
  inset: auto;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: var(--sp-1);
  color: var(--text);
  font: var(--fs-xs) var(--sans);
}
.sheet-item {
  min-height: var(--control-h-sm);
}
.item-label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.item-label svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.sheet-item .item-label svg {
  width: 16px;
  height: 16px;
}
kbd {
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
}
.menu-separator {
  height: 1px;
  margin: var(--sp-1) 6px;
  background: var(--line);
}
</style>
