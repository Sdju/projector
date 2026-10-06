<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import IconEye from "~icons/lucide/eye";
import IconEyeOff from "~icons/lucide/eye-off";
import UiButton from "../../common/ui/UiButton.vue";
import { integrationRequest } from "./client.ts";

const props = defineProps<{ integration: string; label: string; disabled?: boolean }>();
const emit = defineEmits<{ error: [message: string] }>();
const revealed = ref("");
let hideTimer: ReturnType<typeof setTimeout> | undefined;

function hide() {
  clearTimeout(hideTimer);
  revealed.value = "";
}
async function toggle() {
  if (revealed.value) return hide();
  try {
    const data = await integrationRequest<{ token: string }>(`/${props.integration}/token`, "POST");
    revealed.value = data.token;
    hideTimer = setTimeout(hide, 30_000);
  } catch (err) {
    emit("error", err instanceof Error ? err.message : "Ошибка интеграции");
  }
}
onBeforeUnmount(hide);
defineExpose({ hide });
</script>

<template>
  <div class="secret">
    <span class="muted">Токен</span>
    <input
      class="secret-value"
      readonly
      :type="revealed ? 'text' : 'password'"
      :value="revealed || '••••••••••••••••'"
      :aria-label="label"
    />
    <UiButton
      :disabled="disabled"
      :aria-label="revealed ? 'Скрыть токен' : 'Показать токен'"
      :title="revealed ? 'Скрыть токен' : 'Показать токен (скроется через 30 секунд)'"
      @click="toggle"
    >
      <component :is="revealed ? IconEyeOff : IconEye" />
    </UiButton>
  </div>
</template>

<style scoped>
.secret {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin: var(--sp-3) 0;
}
.muted {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.secret-value {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono, monospace);
  font-size: var(--fs-xs);
}
</style>
