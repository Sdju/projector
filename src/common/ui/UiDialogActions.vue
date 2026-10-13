<script setup lang="ts">
import UiInline from "./UiInline.vue";
</script>

<template>
  <UiInline class="actions" align="normal" justify="flex-end"><slot /></UiInline>
</template>

<style scoped>
.actions {
  margin-top: var(--sp-5);
}
</style>
