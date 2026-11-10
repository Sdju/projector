<script setup lang="ts">
import UiButton from "../../common/ui/UiButton.vue";
import UiLoader from "../../common/ui/UiLoader.vue";
import type { DeviceLogin } from "./client.ts";

/** Code and link of an active Device Flow login; the owner runs the cancel command. */
defineProps<{ host: string; device: DeviceLogin; commandId: string }>();
const emit = defineEmits<{ cancel: [] }>();
</script>

<template>
  <div class="device" role="status">
    <p>
      Введите код <strong>{{ device.userCode }}</strong> на странице {{ host }}.
    </p>
    <a :href="device.verificationUri" target="_blank" rel="noopener noreferrer"
      >открыть {{ host }} для входа ↗</a
    >
    <p class="muted"><UiLoader size="sm">Ожидаем подтверждения…</UiLoader></p>
    <UiButton :data-command="commandId" @click="emit('cancel')">отменить</UiButton>
  </div>
</template>

<style scoped>
.device {
  margin-top: var(--sp-4);
  padding: var(--sp-3);
  background: var(--bg-2);
  font-size: var(--fs-xs);
}
.device p {
  margin: 0 0 var(--sp-2);
}
.device strong {
  font-family: var(--mono);
}
.device a {
  color: var(--muted);
  text-decoration: underline;
}
.muted {
  color: var(--muted);
}
</style>
