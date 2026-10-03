<script setup lang="ts">
import { computed, ref } from "vue";
import type { GitBlocksState } from "../lib/git-blocks.ts";
import IconChevronRight from "~icons/lucide/chevron-right";

/**
 * Блок вертикальной панели Git: сворачиваемый заголовок, прокручиваемое тело и граница
 * с следующим раскрытым блоком. Границу можно тянуть; если сжать блок до минимума, он сворачивается.
 */
const props = defineProps<{
  id: string;
  blocks: GitBlocksState;
  /** Контейнер всех блоков: из него читаются текущие высоты. */
  stack: HTMLElement | undefined;
  label: string;
  /** Команда, которой открывается и закрывается блок (для `data-command`). */
  command: string;
}>();
const emit = defineEmits<{ toggle: [] }>();
const STEP = 24;
const dragging = ref(false);
let startY = 0;
let start: Record<string, number> = {};
const collapsed = computed(() => props.blocks.collapsed.value.has(props.id));
const weight = computed(() => props.blocks.weights.value[props.id]);
const below = computed(() => (collapsed.value ? undefined : props.blocks.neighbour(props.id)));
const style = computed(() =>
  collapsed.value
    ? { flex: "0 0 auto" }
    : weight.value !== undefined
      ? { flex: `${weight.value} 1 0px` }
      : { flex: "0 1 auto" },
);
const height = computed(() => Math.round(weight.value ?? 0));

function measure() {
  const sizes: Record<string, number> = {};
  props.stack?.querySelectorAll<HTMLElement>(":scope > [data-block]").forEach((element) => {
    if (element.dataset.collapsed !== "true") sizes[element.dataset.block!] = element.offsetHeight;
  });
  return sizes;
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const handle = event.currentTarget as HTMLElement;
  handle.focus();
  handle.setPointerCapture(event.pointerId);
  start = measure();
  startY = event.clientY;
  dragging.value = true;
}
function move(event: PointerEvent) {
  if (!dragging.value) return;
  if (!props.blocks.resize(props.id, start, event.clientY - startY)) dragging.value = false;
}
function up(event: PointerEvent) {
  dragging.value = false;
  const handle = event.currentTarget as HTMLElement;
  if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
}
function key(event: KeyboardEvent) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) return;
  event.preventDefault();
  if (event.key === "Enter") props.blocks.reset();
  else if (event.key === "Home") props.blocks.setCollapsed(props.id, true);
  else if (event.key === "End" && below.value) props.blocks.setCollapsed(below.value, true);
  else if (event.key === "ArrowUp" || event.key === "ArrowDown")
    props.blocks.resize(
      props.id,
      measure(),
      (event.shiftKey ? 4 : 1) * STEP * (event.key === "ArrowDown" ? 1 : -1),
    );
}
</script>

<template>
  <section
    class="git-block"
    :class="{ collapsed }"
    :style="style"
    :data-block="id"
    :data-collapsed="collapsed"
  >
    <div class="head">
      <button
        class="toggle"
        :aria-expanded="!collapsed"
        :data-command="command"
        @click="emit('toggle')"
      >
        <IconChevronRight class="chevron" :class="{ open: !collapsed }" aria-hidden="true" />
        <h3><slot name="title" /></h3>
      </button>
      <slot name="actions" />
    </div>
    <div v-show="!collapsed" class="body"><slot /></div>
  </section>
  <div
    v-if="below"
    class="separator"
    :class="{ dragging }"
    role="separator"
    aria-orientation="horizontal"
    :aria-label="`Граница блоков: ${label}`"
    :aria-valuenow="height"
    :aria-valuemin="0"
    :title="'Потяните, чтобы изменить высоту блоков · если сжать до минимума, блок сворачивается · двойной клик возвращает размеры'"
    tabindex="0"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
    @lostpointercapture="dragging = false"
    @dblclick="blocks.reset()"
    @keydown="key"
  />
</template>

<style scoped>
.git-block {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.head {
  display: flex;
  flex: none;
  align-items: center;
  padding: 4px var(--sp-3) 2px 8px;
}
.toggle {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  text-align: left;
}
h3 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 0;
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
.chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  color: var(--faint);
}
.chevron.open {
  transform: rotate(90deg);
}
.body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.separator {
  flex: none;
  position: relative;
  height: 9px;
  margin-block: -4px;
  z-index: 1;
  cursor: row-resize;
  touch-action: none;
  user-select: none;
}
.separator::before {
  content: "";
  position: absolute;
  inset: 4px 0;
  background: var(--line);
}
.separator:hover::before,
.separator:focus-visible::before,
.separator.dragging::before {
  inset: 3px 0;
  background: var(--faint);
}
.separator:focus-visible {
  outline: none;
}
</style>
