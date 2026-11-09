<script setup lang="ts">
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import { formatElapsed, useElapsedClock } from "../../agent-core/index.ts";
import type { AgentLens } from "../model/lens.ts";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconScanEye from "~icons/lucide/scan-eye";
import IconTimer from "~icons/lucide/timer";
import IconX from "~icons/lucide/x";

const props = defineProps<{ lens: AgentLens }>();
const now = useElapsedClock();
const ago = computed(() =>
  props.lens.state.at ? `${formatElapsed(now.value - props.lens.state.at)} назад` : "",
);
const stamp = computed(() =>
  props.lens.state.at ? new Date(props.lens.state.at).toLocaleTimeString("ru") : "",
);
</script>

<template>
  <section class="lens" aria-label="Lens: чем агент занят сейчас">
    <div class="lens-head">
      <IconScanEye class="lens-icon" aria-hidden="true" />
      <span class="lens-title">Lens</span>
      <UiSpinner v-if="lens.state.busy" />
      <time v-else-if="ago" class="lens-time" :title="stamp">{{ ago }}</time>
      <UiButton
        shape="icon"
        size="sm"
        :disabled="lens.state.busy"
        title="Обновить описание"
        aria-label="Обновить описание"
        @click="lens.refresh()"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        :class="{ on: lens.state.auto }"
        :aria-pressed="lens.state.auto"
        title="Обновлять по таймеру, пока агент работает"
        aria-label="Автообновление Lens"
        @click="lens.setAuto(!lens.state.auto)"
      >
        <IconTimer aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        title="Скрыть Lens"
        aria-label="Скрыть Lens"
        @click="lens.close()"
      >
        <IconX aria-hidden="true" />
      </UiButton>
    </div>
    <p v-if="lens.state.error" class="lens-text error" role="status">{{ lens.state.error }}</p>
    <p v-else-if="lens.state.text" class="lens-text">{{ lens.state.text }}</p>
    <p v-else class="lens-text empty">
      {{
        lens.state.busy ? "Смотрю, чем занят агент…" : "Обновите, чтобы узнать, чем занят агент."
      }}
    </p>
  </section>
</template>

<style scoped>
/* Embedded in the work header: no card of its own, only the header's divider remains. */
.lens {
  margin: 0;
}
.lens-head {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-height: var(--control-h-sm);
}
.lens-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted);
}
.lens-title {
  margin-right: auto;
  color: var(--text-2);
  font-weight: 600;
}
.lens-time {
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.lens-text {
  margin: var(--sp-1) 0 0;
  color: var(--text-2);
  font-size: var(--fs-2xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.lens-text.error {
  color: var(--err);
}
.lens-text.empty {
  color: var(--faint);
}
.lens :deep(.on) {
  color: var(--run);
  background: transparent;
}
</style>
