<script setup lang="ts">
import UiPanel from "../../../common/ui/UiPanel.vue";
import { onBeforeUnmount, onMounted, ref, computed } from "vue";
import type { PanelHosts } from "../panel-hosts.ts";

const props = defineProps<{ id: string; registry: PanelHosts }>();
const panel = ref<InstanceType<typeof UiPanel>>();
const element = computed(() => panel.value?.element);
onMounted(() => props.registry.register(props.id, element.value!));
onBeforeUnmount(() => props.registry.unregister(props.id, element.value!));
</script>

<template>
  <UiPanel as="div" sizing="flex" ref="panel" class="panel-host" />
</template>
