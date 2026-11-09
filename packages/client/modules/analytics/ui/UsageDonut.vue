<script setup lang="ts">
import UiDonut from "../../../common/ui/UiDonut.vue";

defineProps<{
  items: { label: string; value: number; share?: number }[];
  center?: string;
  format?: (value: number) => string;
}>();
</script>

<template>
  <UiDonut
    :items="items"
    :center="center"
    :format="format"
    show-values
    aria-label="Доля токенов по агентам"
  />
</template>
