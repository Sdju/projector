<script setup lang="ts">
import { computed, useId } from "vue";

const props = defineProps<{ label: string; name?: string }>();
const id = useId();
const groupName = computed(() => props.name ?? id);
</script>

<template>
  <fieldset class="choice-group">
    <legend class="u-sr-only">{{ label }}</legend>
    <slot :group-name="groupName" />
  </fieldset>
</template>

<style scoped>
.choice-group {
  border: 0;
  padding: 0;
  margin: 0;
}
</style>
