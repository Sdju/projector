<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import type { DockerDaemonState } from "../../../../core/modules/docker/index.ts";

/** Docker error with the way out: start the daemon here, or the steps to do it by hand. */
defineProps<{
  message: string;
  daemon?: DockerDaemonState;
  starting: boolean;
  size?: "2xs" | "xs" | "sm";
}>();
defineEmits<{ start: [] }>();
</script>

<template>
  <div class="notice">
    <UiMessage tone="danger" role="alert" variant="padded" :size="size ?? 'xs'" flush wrap>{{
      daemon?.state === "stopped" ? "Docker daemon не запущен." : message
    }}</UiMessage>
    <div v-if="daemon" class="offer">
      <template v-if="daemon.start.auto">
        <UiButton size="sm" :disabled="starting" @click="$emit('start')">
          <UiSpinner v-if="starting" /> {{ starting ? "Запускаю…" : "Запустить Docker" }}
        </UiButton>
        <span class="how">{{ daemon.start.label }}</span>
      </template>
      <span v-else class="how">{{ daemon.start.manual }}</span>
    </div>
  </div>
</template>

<style scoped>
.offer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  padding: 0 var(--sp-3) var(--sp-2);
}
.how {
  color: var(--muted);
  font-size: var(--fs-2xs);
  overflow-wrap: anywhere;
}
.offer svg {
  width: 12px;
  height: 12px;
}
</style>
