<script setup lang="ts">
import { computed, inject, provide, unref, watch } from "vue";
import { formPresetKey } from "../../../widget-runtime/index.ts";
import { createForm, formKey } from "../../_/form.ts";

const preset = inject(formPresetKey, null);
const form = createForm(preset);
const readonly = computed(() => unref(preset?.readonly) === true);
// Unlocking a sent snapshot starts a new answer: the old "sent" lock must not keep it disabled.
watch(readonly, (locked) => {
  if (!locked) form.sent.value = false;
});
provide(formKey, form);
</script>

<template>
  <fieldset class="form" :disabled="form.sent.value || readonly">
    <slot />
  </fieldset>
</template>

<style scoped>
.form {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
</style>
