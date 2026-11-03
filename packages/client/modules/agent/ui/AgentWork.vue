<script setup lang="ts">
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandHeader from "../../../common/ui/UiIslandHeader.vue";
import { useElementVisibility, useEventListener } from "@vueuse/core";
import { computed, ref, watch, type ComponentPublicInstance } from "vue";
import { useCompactViewport } from "../../../common/utilities/compact-viewport.ts";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { formatElapsed, useElapsedClock } from "../lib/elapsed.ts";
import { inputHint } from "../lib/tool-input.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentWorkItem } from "../lib/work-items.ts";
import type { AgentLens } from "../model/lens.ts";
import AgentLensPanel from "./AgentLens.vue";
import AgentWorkBody from "./AgentWorkBody.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconCheck from "~icons/lucide/check";
import IconChevron from "~icons/lucide/chevron-right";
import UiSpinner from "../../../common/ui/UiSpinner.vue";

const props = defineProps<{
  items: AgentWorkItem[];
  busy: boolean;
  last: boolean;
  /** This group is the last one in the answer, so it may be the step being worked on. */
  current?: boolean;
  /** Some call of the answer is still running, even if it belongs to another group. */
  anyRunning?: boolean;
  root?: string;
  /** The chat's Lens, when it is on: a live caption of what the agent is doing. */
  lens?: AgentLens;
}>();
const emit = defineEmits<{ open: [path: string] }>();

const compact = useCompactViewport();
// On a phone the body is a bottom sheet: its height is bounded by the viewport, and it always
// has a visible way out (header, Escape, backdrop). Inline expansion stays for the desktop.
const menu = useIslandMenu({
  anchor: "left",
  initialFocus: ".work-sheet-title",
  // A content panel, not a menu: arrow keys must keep working inside the calls it shows.
  items: "[data-work-nav]",
  returnFocus: ".work-summary",
});
const work = ref<HTMLElement>();
function bindWork(element: Element | ComponentPublicInstance | null) {
  work.value = (element as HTMLElement | null) ?? undefined;
  menu.trigger.value = work.value;
}
// The tab is hidden (moved to the keep-alive host): the teleported sheet must not stay on screen.
const visible = useElementVisibility(work);

// Closed by default: the body is mounted only while it is shown, so a long answer keeps its
// thoughts and calls out of the DOM until the user asks for them.
const open = ref(false);
watch(visible, (shown) => {
  if (!shown) menu.close(false);
});
watch(compact, () => {
  menu.close(false);
  open.value = false;
});
// The sheet is a dialog without a focus trap: Escape must work even when focus left it.
useEventListener(window, "keydown", (event) => {
  if (event.key !== "Escape" || !menu.open.value) return;
  event.preventDefault();
  menu.close();
});
const toggle = (event: Event) => {
  const element = event.target as HTMLDetailsElement;
  if (compact.value) {
    element.open = false;
    return;
  }
  open.value = element.open;
};
// On the phone the summary only opens the sheet: details never expands inline.
function summaryClick(event: MouseEvent) {
  if (!compact.value) return;
  event.preventDefault();
  void menu.toggle();
}
function openFromIsland(path: string) {
  menu.close(false);
  emit("open", path);
}

const running = computed(() =>
  props.items
    .flatMap((item) => (item.type === "tools" ? item.tools : []))
    .findLast((tool) => tool.status === "running"),
);
const active = computed(() => props.busy && props.last);
// The agent is reasoning when this is the work group still in progress and no call is running.
const thinking = computed(
  () => active.value && props.current === true && !running.value && props.anyRunning !== true,
);
const live = computed(() => active.value && Boolean(running.value || thinking.value));
const failed = computed(() =>
  props.items.some(
    (item) => item.type === "tools" && item.tools.some((tool) => tool.status === "error"),
  ),
);
const step = computed(() => {
  if (running.value) return toolLabel(running.value.name);
  return thinking.value ? "Думает…" : "";
});
const hint = computed(() =>
  running.value ? inputHint(running.value.input ?? running.value.detail) : "",
);
const title = computed(() => [step.value, hint.value].filter(Boolean).join(" "));
const now = useElapsedClock();
const elapsed = computed(() => {
  const tool = running.value;
  if (!active.value || !tool || tool.startedAt === undefined) return "";
  return formatElapsed(now.value - tool.startedAt);
});
</script>

<template>
  <details
    :ref="bindWork"
    class="work"
    :class="{ 'island-open': compact && menu.open.value }"
    :data-compact="compact ? '' : undefined"
    :open="!compact && open ? true : undefined"
    @toggle="toggle"
  >
    <UiDisclosureSummary variant="fit" class="work-summary" @click="summaryClick">
      <UiSpinner v-if="live" />
      <IconAlert v-else-if="failed" class="work-icon error" aria-hidden="true" />
      <IconCheck v-else class="work-icon" aria-hidden="true" />
      <span class="work-title">Работа</span>
      <template v-if="!open && lens && lens.state.open && lens.state.text">
        <span class="work-lens-label">Lens</span>
        <span class="work-lens u-truncate" :title="lens.state.text">{{ lens.state.text }}</span>
      </template>
      <template v-else-if="!open && step">
        <span class="work-step u-truncate" :title="title"
          >{{ step }}<span v-if="hint" class="work-hint">{{ " " + hint }}</span></span
        >
        <span v-if="elapsed" class="work-time">{{ elapsed }}</span>
      </template>
      <IconChevron class="work-chevron" aria-hidden="true" />
    </UiDisclosureSummary>
    <div v-if="!compact && open && lens && lens.state.open" class="work-head">
      <AgentLensPanel :lens="lens" />
    </div>
    <div v-if="!compact && open" class="work-body">
      <AgentWorkBody
        :items="items"
        :thinking="thinking"
        :root="root"
        @open="(path) => emit('open', path)"
      />
    </div>
  </details>
  <UiIsland v-if="compact" :menu="menu" label="Работа" :width="420" gap="var(--sp-2)">
    <div class="work-sheet-head">
      <UiIslandHeader
        anchor="start"
        chevron
        class="work-sheet-title"
        aria-label="Закрыть работу"
        @click="menu.close()"
      >
        <span class="work-head-title">Работа</span>
        <span v-if="title" class="work-head-step">{{ title }}</span>
      </UiIslandHeader>
      <AgentLensPanel v-if="lens && lens.state.open" class="work-head-lens" :lens="lens" />
    </div>
    <div class="work-sheet-steps">
      <AgentWorkBody :items="items" :thinking="thinking" :root="root" @open="openFromIsland" />
    </div>
  </UiIsland>
  <!-- The sheet's shadow only paints the scrim: this catches the tap so nothing opens under it. -->
  <Teleport to="body">
    <button
      v-if="compact && menu.open.value"
      type="button"
      class="work-scrim"
      tabindex="-1"
      aria-label="Закрыть работу"
      @click="menu.close(false)"
      @touchmove.prevent
      @wheel.prevent
    />
  </Teleport>
</template>

<style scoped>
.work {
  margin: 0 0 var(--sp-3);
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.work:last-child {
  margin-bottom: 0;
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.work-icon {
  color: var(--faint);
}
.work-icon.error {
  color: var(--err);
}
.work-step {
  min-width: 0;
  color: var(--text-2);
}
.work-hint {
  color: var(--faint);
}
.work-lens-label {
  flex-shrink: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}
.work-lens {
  min-width: 0;
  color: var(--text-2);
}
.work-time {
  flex-shrink: 0;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.work-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.work[open] > summary .work-chevron,
.work.island-open > summary .work-chevron {
  transform: rotate(90deg);
}
/* The header (title, Lens) is one block: the only separator is the line above the steps. */
.work-head {
  padding-top: var(--sp-1);
}
.work-body {
  max-height: min(60vh, 520px);
  padding-top: var(--sp-1);
  border-top: 1px solid var(--line);
  overflow-y: auto;
  overscroll-behavior: contain;
}
/* The way out stays on screen while a long body scrolls under it. */
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .work-summary {
    min-height: 32px;
    padding-block: var(--sp-2);
  }
  .work-sheet-head {
    position: sticky;
    top: calc(-1 * var(--sp-1));
    z-index: 1;
    margin: calc(-1 * var(--sp-1)) calc(-1 * var(--sp-1)) 0;
    padding: var(--sp-1);
    background: var(--bg-2);
    border-bottom: 1px solid var(--line);
  }
  .work-head-lens {
    padding-inline: 7px;
  }
  .work-sheet-steps {
    padding: var(--sp-1) 7px;
  }
}
.work-head-title {
  font-weight: 600;
}
.work-head-step {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.work-scrim {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-popover) - 1);
  border: 0;
  background: transparent;
  touch-action: none;
}
@media (prefers-reduced-motion: reduce) {
  .work-chevron {
    transition: none;
  }
}
</style>
