<script setup lang="ts">
import UiStat from "../../../../common/ui/UiStat.vue";

defineProps<{ label: string; value: string | number; delta?: number; hint?: string }>();
</script>

<template>
  <UiStat class="stat" :label="label" :value="value" :delta="delta" :hint="hint" size="lg" />
</template>
