<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from "vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { AgentControl } from "../model/types.ts";
import IconChevron from "~icons/lucide/chevron-up";
import IconNext from "~icons/lucide/chevron-right";
import IconBack from "~icons/lucide/chevron-left";
import IconCheck from "~icons/lucide/check";
import IconModel from "~icons/lucide/cpu";
import IconEffort from "~icons/lucide/brain";
import IconMode from "~icons/lucide/shield-check";
import IconOther from "~icons/lucide/sliders-horizontal";

const props = defineProps<{ controls: AgentControl[]; disabled: boolean }>();
const emit = defineEmits<{ change: [id: string, value: string] }>();

/** Остров над полем ввода: все параметры агента с пояснениями, а в триггере — суть выбора. */
const menu = useIslandMenu({
  anchor: "left",
  placement: "above",
  initialFocus: ["button.option.current", "button.option"],
  returnFocus: ".trigger",
});
const { open, toggle, close } = menu;

const icons: Record<AgentControl["category"], Component> = {
  model: IconModel,
  effort: IconEffort,
  mode: IconMode,
  other: IconOther,
};
function currentName(control: AgentControl): string {
  return control.options.find((item) => item.value === control.current)?.name ?? control.current;
}
const summary = computed(() =>
  props.controls
    .filter((control) => control.category !== "other")
    .map((control) => ({
      id: control.id,
      category: control.category,
      name: control.name,
      value: currentName(control),
    })),
);
/** Каскад: корень острова — список параметров, выбор параметра открывает его варианты. */
const view = ref<string>();
const selected = computed(() => props.controls.find((control) => control.id === view.value));
watch(open, (value) => {
  if (!value) view.value = undefined;
});
async function show(id?: string) {
  view.value = id;
  await nextTick();
  menu.island.value
    ?.querySelector<HTMLElement>("button.option.current, button.option, button.row")
    ?.focus();
}
function pick(control: AgentControl, value: string) {
  if (value !== control.current) emit("change", control.id, value);
  close();
}
function back(event: KeyboardEvent) {
  if (!selected.value) return;
  event.preventDefault();
  void show();
}
defineExpose({ toggle: () => menu.toggle() });
</script>

<template>
  <div v-if="controls.length" :ref="menu.trigger" class="agent-controls">
    <button
      type="button"
      class="trigger"
      :disabled="disabled"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      aria-label="Параметры агента"
      @click="toggle()"
    >
      <span
        v-for="item in summary"
        :key="item.id"
        class="chip"
        :data-category="item.category"
        :title="`${item.name}: ${item.value}`"
      >
        <component :is="icons[item.category]" aria-hidden="true" /><span class="value">{{
          item.value
        }}</span>
      </span>
      <IconOther v-if="!summary.length" aria-hidden="true" />
      <IconChevron class="arrow" aria-hidden="true" />
    </button>
  </div>
  <UiIsland :menu="menu" label="Параметры агента" :width="300">
    <div v-if="!selected" class="rows" role="group" aria-label="Параметры агента">
      <button
        v-for="control in controls"
        :key="control.id"
        type="button"
        class="row"
        :title="control.description"
        @click="show(control.id)"
      >
        <component :is="icons[control.category]" class="lead" aria-hidden="true" />
        <span class="copy"
          ><span class="name">{{ control.name }}</span
          ><span class="caption">{{ currentName(control) }}</span></span
        >
        <IconNext class="next" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="options" role="group" :aria-label="selected.name" @keydown.left="back">
      <button type="button" class="head" @click="show()">
        <IconBack aria-hidden="true" />
        <span class="copy"
          ><span class="name">{{ selected.name }}</span
          ><span v-if="selected.description" class="caption">{{ selected.description }}</span></span
        >
      </button>
      <div class="list">
        <button
          v-for="option in selected.options"
          :key="option.value"
          type="button"
          class="option"
          :class="{ current: option.value === selected.current }"
          role="menuitemradio"
          :aria-checked="option.value === selected.current"
          @click="pick(selected, option.value)"
        >
          <span class="copy"
            ><span class="name">{{ option.name }}</span
            ><span v-if="option.description" class="caption">{{ option.description }}</span></span
          >
          <IconCheck v-if="option.value === selected.current" class="check" aria-hidden="true" />
        </button>
      </div>
    </div>
  </UiIsland>
</template>

<style scoped>
.agent-controls {
  display: flex;
  min-width: 0;
}
.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  height: var(--control-h-sm);
  padding: 0 var(--sp-2);
  border-radius: var(--r-md);
  color: var(--muted);
  font-size: var(--fs-2xs);
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.trigger:hover:not(:disabled),
.trigger[aria-expanded="true"] {
  background: var(--hover);
  color: var(--text);
}
.trigger:disabled {
  opacity: 0.6;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.chip svg,
.arrow {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.value {
  overflow: hidden;
  max-width: 150px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chip[data-category="mode"] {
  color: var(--faint);
}
.rows,
.options,
.list {
  display: flex;
  flex-direction: column;
}
.list {
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
}
.row,
.option,
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: 6px var(--sp-2);
  border-radius: var(--r-md);
  text-align: left;
}
.row:hover,
.row:focus-visible,
.option:hover,
.option:focus-visible,
.head:hover,
.head:focus-visible {
  background: var(--active);
  outline: none;
}
.head {
  margin-bottom: var(--sp-1);
  border-bottom: 1px solid var(--line);
  border-radius: var(--r-md) var(--r-md) 0 0;
  color: var(--text);
}
.lead,
.head svg,
.next {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted);
}
.next {
  color: var(--faint);
}
.copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: var(--fs-sm);
}
.caption {
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.row .caption {
  color: var(--text-2);
}
.option.current .name {
  color: var(--text);
  font-weight: 600;
}
.check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--run);
}
@container (max-width: 500px) {
  .chip[data-category="mode"] .value {
    display: none;
  }
}
</style>
