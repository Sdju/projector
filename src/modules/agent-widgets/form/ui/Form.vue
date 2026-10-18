<script setup lang="ts">
import { provide } from "vue";
import { createForm, formKey } from "../../_/form.ts";

const form = createForm();
provide(formKey, form);
</script>

<template>
  <fieldset class="form" :disabled="form.sent.value">
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
