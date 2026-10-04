<script setup lang="ts">
import { computed, ref } from "vue";
import { SettingsWorkbench } from "../settings/index.ts";
import { settingsSections } from "./sections.ts";
const props = defineProps<{ selected?: string; embedded?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const selection = ref("interface");
const current = computed(() => props.selected ?? selection.value);
function select(id: string) {
  selection.value = id;
  emit("select", id);
}
</script>
<template>
  <SettingsWorkbench
    :sections="settingsSections"
    :selected="current"
    :embedded="embedded"
    @select="select"
  />
</template>
