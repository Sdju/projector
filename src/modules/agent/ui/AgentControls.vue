<script setup lang="ts">
import UiInline from "../../../common/ui/UiInline.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiActionCopy from "../../../common/ui/UiActionCopy.vue";
import { computed, nextTick, ref, watch, type Component } from "vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import type { McpServer } from "../api/client.ts";
import type { AgentControl } from "../model/types.ts";
import IconChevron from "~icons/lucide/chevron-up";
import IconNext from "~icons/lucide/chevron-right";
import IconBack from "~icons/lucide/chevron-left";
import IconCheck from "~icons/lucide/check";
import IconModel from "~icons/lucide/cpu";
import IconEffort from "~icons/lucide/brain";
import IconMode from "~icons/lucide/shield-check";
import IconOther from "~icons/lucide/sliders-horizontal";

const props = defineProps<{
  controls: AgentControl[];
  disabled: boolean;
  /** MCP servers the agent works with in this project. */
  mcp?: McpServer[];
}>();
const emit = defineEmits<{ change: [id: string, value: string]; opened: [] }>();

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
  else emit("opened");
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
      <UiInline
        as="span"
        inline
        :gap="1.25"
        justify="normal"
        v-for="item in summary"
        :key="item.id"
        class="chip"
        :data-category="item.category"
        :title="`${item.name}: ${item.value}`"
      >
        <component :is="icons[item.category]" aria-hidden="true" /><span class="value u-truncate">{{
          item.value
        }}</span>
      </UiInline>
      <IconOther v-if="!summary.length" aria-hidden="true" />
      <IconChevron class="arrow" aria-hidden="true" />
    </button>
  </div>
  <UiIsland :menu="menu" label="Параметры агента" :width="300">
    <UiStack
      flow="flex"
      gap="none"
      v-if="!selected"
      class="rows"
      role="group"
      aria-label="Параметры агента"
    >
      <UiActionRow
        v-for="control in controls"
        :key="control.id"
        type="button"
        class="row"
        :title="control.description"
        @click="show(control.id)"
      >
        <component :is="icons[control.category]" class="lead" aria-hidden="true" />
        <UiActionCopy
          :title="control.name"
          :description="currentName(control)"
          description-mode="wrap"
          description-tone="secondary"
        />
        <IconNext class="next" aria-hidden="true" />
      </UiActionRow>
      <div v-if="mcp?.length" class="mcp" role="group" aria-label="MCP-серверы">
        <span class="mcp-title">MCP-серверы</span>
        <span
          v-for="server in mcp"
          :key="server.name"
          class="mcp-row"
          :title="server.error || server.status"
        >
          <UiStatusDot
            as="i"
            :size="6"
            radius="circle"
            :tone="server.status === 'connected' ? 'success' : server.error ? 'danger' : 'faint'"
          />
          <span class="mcp-name u-truncate">{{ server.name }}</span>
          <span class="mcp-state"
            >{{ server.status === "connected" ? "работает" : server.status
            }}{{ server.tools ? ` · ${server.tools}` : "" }}</span
          >
        </span>
      </div>
    </UiStack>
    <UiStack
      flow="flex"
      gap="none"
      v-else
      class="options"
      role="group"
      :aria-label="selected.name"
      @keydown.left="back"
    >
      <UiActionRow separator="after" tone="neutral" type="button" class="head" @click="show()">
        <IconBack aria-hidden="true" />
        <UiActionCopy
          :title="selected.name"
          :description="selected.description"
          description-mode="wrap"
        />
      </UiActionRow>
      <UiStack flow="flex" gap="none" class="list">
        <UiActionRow
          v-for="option in selected.options"
          :key="option.value"
          type="button"
          class="option"
          :class="{ current: option.value === selected.current }"
          role="menuitemradio"
          :aria-checked="option.value === selected.current"
          @click="pick(selected, option.value)"
        >
          <UiActionCopy
            :title="option.name"
            :description="option.description"
            description-mode="wrap"
            :emphasized="option.value === selected.current"
          />
          <IconCheck v-if="option.value === selected.current" class="check" aria-hidden="true" />
        </UiActionRow>
      </UiStack>
    </UiStack>
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
  min-width: 0;
}
.chip svg,
.arrow {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.value {
  max-width: 150px;
}
.chip[data-category="mode"] {
  color: var(--faint);
}
.mcp {
  display: grid;
  gap: 2px;
  margin-top: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--line);
  font-size: var(--fs-2xs);
  color: var(--muted);
}
.mcp-title {
  color: var(--faint);
}
.mcp-row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.mcp-name {
  min-width: 0;
  flex: 1;
  color: var(--text-2);
}
.mcp-state {
  flex-shrink: 0;
}
.list {
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
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
