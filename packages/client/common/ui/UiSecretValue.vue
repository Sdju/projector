<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import UiButton from "./UiButton.vue";
import UiControl from "./UiControl.vue";

const props = withDefaults(
  defineProps<{
    value: string;
    label?: string;
    /** Seconds the value stays revealed after a click; 0 keeps it until the next click. */
    hideAfter?: number;
  }>(),
  { hideAfter: 30 },
);

const revealed = ref(false);
const copied = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let copyTimer: ReturnType<typeof setTimeout> | undefined;

const masked = computed(() => "•".repeat(Math.min(Math.max(props.value.length, 12), 48)));
const rows = computed(() => Math.min(Math.max(props.value.split("\n").length, 1), 8));

function clearHide() {
  if (hideTimer !== undefined) clearTimeout(hideTimer);
  hideTimer = undefined;
}
function hide() {
  clearHide();
  revealed.value = false;
}
function toggle() {
  if (revealed.value) return hide();
  revealed.value = true;
  clearHide();
  if (props.hideAfter > 0) hideTimer = setTimeout(hide, props.hideAfter * 1_000);
}
async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    copied.value = true;
    if (copyTimer !== undefined) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied.value = false), 2_000);
  } catch {
    copied.value = false;
  }
}
watch(
  () => props.value,
  () => {
    hide();
    copied.value = false;
  },
);
onBeforeUnmount(() => {
  clearHide();
  if (copyTimer !== undefined) clearTimeout(copyTimer);
});
</script>

<template>
  <div class="secret-value">
    <UiControl
      class="control"
      as="textarea"
      readonly
      :rows="rows"
      :value="revealed ? value : masked"
      :aria-label="label || 'Секрет'"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      data-1p-ignore
      data-lpignore="true"
    />
    <div class="actions">
      <UiButton
        size="sm"
        :aria-label="revealed ? 'Скрыть секрет' : 'Показать секрет'"
        @click="toggle"
      >
        {{ revealed ? "Скрыть" : "Показать" }}
      </UiButton>
      <UiButton size="sm" aria-label="Скопировать секрет" @click="copy">
        {{ copied ? "Скопировано" : "Копировать" }}
      </UiButton>
    </div>
  </div>
</template>

<style scoped>
.secret-value {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
.control {
  width: 100%;
  min-height: calc(var(--control-h) + 8px);
  padding: var(--sp-2);
  resize: vertical;
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
</style>
