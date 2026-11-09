<script setup lang="ts">
import UiDonut from "../../../../common/ui/UiDonut.vue";

defineProps<{ items: { label: string; value: number }[]; center?: string }>();
</script>

<template>
  <UiDonut :items="items" :center="center" />
</template>
