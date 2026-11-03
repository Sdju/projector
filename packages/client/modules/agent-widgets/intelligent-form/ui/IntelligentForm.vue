<script setup lang="ts">
import { computed, inject, onBeforeUnmount, provide, unref, watch } from "vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { formChromeKey, formPresetKey, useWidgetReply } from "../../../widget-runtime/index.ts";
import { createForm, formKey } from "../../_/form.ts";

/** The answer form: fields come from the slot, the submit button and its reply are built in. */
const props = defineProps<{
  submit?: string;
  summary?: string;
  sentLabel?: string;
}>();
const preset = inject(formPresetKey, null);
const chrome = inject(formChromeKey, null);
const form = createForm(preset);
const reply = useWidgetReply();
const readonly = computed(() => unref(preset?.readonly) === true);
const locked = computed(() => form.sent.value || readonly.value);
const ownSubmit = chrome?.composer !== true;
// Unlocking a sent snapshot starts a new answer: the old lock must not keep it disabled.
watch(readonly, (value) => {
  if (!value) form.sent.value = false;
});
provide(formKey, form);
const unregister = chrome?.registerSubmit?.(send);
onBeforeUnmount(() => unregister?.());

function send() {
  if (locked.value) return false;
  if (!reply(form.values(), props.summary)) return false;
  form.sent.value = true;
  return true;
}
</script>

<template>
  <fieldset class="intelligent-form" :disabled="locked">
    <slot />
    <div v-if="ownSubmit" class="actions">
      <UiButton :disabled="locked" @click="send">
        {{ locked ? (sentLabel ?? "Отправлено") : (submit ?? "Отправить") }}
      </UiButton>
    </div>
  </fieldset>
</template>

<style scoped>
.intelligent-form {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
}
</style>
