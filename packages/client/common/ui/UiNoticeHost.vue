<script setup lang="ts">
import UiPopupSurface from "./UiPopupSurface.vue";
import { dismissNotice, dismissToast, notices, toasts, type Notice } from "../utilities/notice.ts";
import IconCheck from "~icons/lucide/check";
import IconAlert from "~icons/lucide/circle-alert";
import IconClose from "~icons/lucide/x";

/** Слой информационных тултипов (см. utilities/notice.ts). */
const GAP = 8;
const EDGE = 16;
function place(notice: Notice) {
  // Над якорем; у верхнего края окна — под ним. Не выходит за боковые края.
  const below = notice.y < 56;
  return {
    left: `${Math.min(Math.max(notice.x, EDGE + 40), window.innerWidth - EDGE - 40)}px`,
    top: `${below ? notice.y + notice.height + GAP : notice.y - GAP}px`,
    translate: below ? "-50% 0" : "-50% -100%",
  };
}
</script>

<template>
  <Teleport to="body">
    <div class="notice-layer" aria-live="polite">
      <UiPopupSurface
        border="strong"
        radius="md"
        surface="tertiary"
        v-for="notice in notices"
        :key="notice.id"
        class="notice"
        :class="[notice.kind, { below: notice.y < 56 }]"
        :role="notice.kind === 'error' ? 'alert' : 'status'"
        :style="place(notice)"
        @click="dismissNotice(notice.id)"
      >
        <IconCheck v-if="notice.kind === 'success'" aria-hidden="true" />
        <IconAlert v-else aria-hidden="true" />
        <span>{{ notice.text }}</span>
      </UiPopupSurface>
    </div>
    <div class="toast-layer" role="region" aria-label="Ошибки">
      <div v-for="toast in toasts" :key="toast.id" class="toast" role="alert">
        <IconAlert aria-hidden="true" />
        <span class="toast-text">{{ toast.text }}</span>
        <button
          v-if="toast.action"
          type="button"
          class="toast-action"
          @click="
            toast.action.run();
            dismissToast(toast.id);
          "
        >
          {{ toast.action.label }}
        </button>
        <button
          type="button"
          class="toast-close"
          aria-label="Закрыть"
          title="Закрыть"
          @click="dismissToast(toast.id)"
        >
          <IconClose aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.notice-layer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-popover) + 10);
  pointer-events: none;
}
.notice {
  position: absolute;
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  max-width: min(360px, calc(100vw - 2 * var(--sp-4)));
  padding: var(--sp-1) var(--sp-3);
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh);
  animation: notice-in var(--t-base);
}
.notice svg {
  flex: none;
  width: 14px;
  height: 14px;
}
.notice.success svg {
  color: var(--run);
}
.notice.error {
  pointer-events: auto;
  cursor: pointer;
  align-items: flex-start;
  padding: var(--sp-2) var(--sp-3);
  border-color: var(--err);
  background: var(--bg-2);
  color: var(--err);
}
.notice.error svg {
  margin-top: 2px;
}
.notice::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -5px;
  width: 8px;
  height: 8px;
  translate: -50%;
  rotate: 45deg;
  border: solid var(--line-strong);
  border-width: 0 1px 1px 0;
  background: inherit;
}
.notice.below::after {
  bottom: auto;
  top: -5px;
  rotate: 225deg;
}
.notice.error::after {
  border-color: var(--err);
}
.toast-layer {
  position: fixed;
  right: var(--sp-4);
  bottom: 40px;
  z-index: calc(var(--z-popover) + 10);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  width: min(380px, calc(100vw - 2 * var(--sp-4)));
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-2) var(--sp-2) var(--sp-3);
  border: 1px solid var(--err);
  border-radius: var(--r-md);
  background: var(--bg-2);
  box-shadow: var(--shadow-pop, 0 4px 16px rgb(0 0 0 / 0.3));
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh);
  pointer-events: auto;
  animation: notice-in var(--t-base);
}
.toast > svg {
  flex: none;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  color: var(--err);
}
.toast-text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.toast-action,
.toast-close {
  flex: none;
  border-radius: var(--r-sm);
  color: var(--muted);
}
.toast-action {
  padding: 0 var(--sp-2);
  color: var(--text);
  text-decoration: underline;
}
.toast-close {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
}
.toast-close svg {
  width: 12px;
  height: 12px;
}
.toast-action:hover,
.toast-close:hover {
  background: var(--hover);
  color: var(--text);
}
@keyframes notice-in {
  from {
    opacity: 0;
    margin-top: 4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice,
  .toast {
    animation: none;
  }
}
</style>
