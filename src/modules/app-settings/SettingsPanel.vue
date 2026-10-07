<script setup lang="ts">
import { computed, ref } from "vue";
import { SettingsWorkbench, type SettingsReadoutState } from "../settings/index.ts";
import { readoutLines } from "../../common/utilities/tab-readout.ts";
import { settingsSections } from "./sections.ts";
const props = defineProps<{ selected?: string; embedded?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const selection = ref("interface");
const current = computed(() => props.selected ?? selection.value);
function select(id: string) {
  selection.value = id;
  emit("select", id);
}
// Что штатный агент видит во вкладке настроек Projector.
const readout = (state: SettingsReadoutState) => ({
  note: "Настройки Projector",
  text: readoutLines(
    `Раздел: ${state.sectionTitle || state.section || "—"}`,
    state.query ? `Поиск: «${state.query}»` : "",
    `Видимых разделов: ${state.visible}`,
  ),
});
</script>
<template>
  <SettingsWorkbench
    :sections="settingsSections"
    :selected="current"
    :embedded="embedded"
    :read="readout"
    @select="select"
  />
</template>
