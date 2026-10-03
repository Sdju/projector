<script setup lang="ts">
import { dismissNotice, notices, type Notice } from "../utilities/notice.ts";
import IconCheck from "~icons/lucide/check";
import IconAlert from "~icons/lucide/circle-alert";

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
      <div
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
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text);
  box-shadow: var(--shadow-popover);
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
@keyframes notice-in {
  from {
    opacity: 0;
    margin-top: 4px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .notice {
    animation: none;
  }
}
</style>
