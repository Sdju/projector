<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { PanelHosts } from "../panel-hosts.ts";

const props = defineProps<{ id: string; registry: PanelHosts }>();
const element = ref<HTMLElement>();
onMounted(() => props.registry.register(props.id, element.value!));
onBeforeUnmount(() => props.registry.unregister(props.id, element.value!));
</script>

<template>
  <div ref="element" class="panel-host" />
</template>

<style scoped>
.panel-host {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
</style>
