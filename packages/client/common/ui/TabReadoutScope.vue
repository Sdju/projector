<script setup lang="ts">
import { provideTabReadout } from "../utilities/tab-readout.ts";

/** Даёт view вкладки её ключ, чтобы тот публиковал снапшот для штатного агента. */
const props = defineProps<{ tabKey: string }>();
provideTabReadout(() => props.tabKey);
</script>

<template>
  <slot />
</template>
