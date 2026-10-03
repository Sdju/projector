<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId } from "vue";
import type { ContextMenuItem } from "./context-menu.ts";
const props = defineProps<{ items: ContextMenuItem[]; label?: string }>();
const menu = ref<HTMLElement>();
const anchorName = `--context-${useId().replace(/[^a-z0-9-]/gi, "")}`;
const point = ref({ x: 0, y: 0 });
let trigger: HTMLElement | undefined;
let restoreFocus = false;
let opening = 0;
let releaseListener: (() => void) | undefined;
function close(focus = true) {
  opening++;
  if (releaseListener) window.removeEventListener("pointerup", releaseListener);
  releaseListener = undefined;
  restoreFocus = focus;
  menu.value?.hidePopover();
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
  // On Linux contextmenu fires on press; showing before release lets the native
  // popover light-dismiss consume the same right click that opened the menu.
  if (event instanceof MouseEvent && event.buttons !== 0) {
    await new Promise<void>((resolve) => {
      releaseListener = () => {
        releaseListener = undefined;
        setTimeout(resolve, 0);
      };
      window.addEventListener("pointerup", releaseListener, { once: true });
    });
  }
  await nextTick();
  if (generation !== opening) return;
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
  if (event.type === "scroll" && event.target instanceof Node && menu.value?.contains(event.target))
    return;
  close(false);
}
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
</script>
<template>
  <Teleport to="body">
    <span
      class="context-anchor"
      :style="{ left: `${point.x}px`, top: `${point.y}px`, anchorName }"
    />
    <div
      ref="menu"
      popover="auto"
      role="menu"
      class="context-menu"
      :aria-label="label || 'Действия'"
      :style="{ positionAnchor: anchorName }"
      @toggle="toggle"
      @keydown="keydown"
      @contextmenu.prevent.stop
    >
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separator" role="separator" class="menu-separator" />
        <button
          role="menuitem"
          :data-command="item.command"
          :disabled="item.disabled"
          :class="{ danger: item.danger }"
          @click="activate(item)"
        >
          <span>{{ item.label }}</span
          ><kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
        </button>
      </template>
    </div>
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
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text);
  box-shadow: var(--shadow-popover);
  font: var(--fs-xs) var(--sans);
}
.context-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-5);
  width: 100%;
  padding: 7px 10px;
  text-align: left;
  border-radius: var(--r-sm);
  color: inherit;
}
.context-menu button:hover:not(:disabled),
.context-menu button:focus-visible {
  background: var(--active);
  outline: none;
}
.context-menu button:disabled {
  opacity: 0.45;
}
.context-menu button.danger {
  color: var(--err);
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
