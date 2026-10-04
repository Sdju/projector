<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { SettingsPanel } from "../modules/app-settings/index.ts";
const route = useRoute();
const router = useRouter();
const section = computed(() =>
  typeof route.query.section === "string" ? route.query.section : "interface",
);
function selectSection(id: string) {
  return router.push({ query: { ...route.query, section: id } });
}
</script>
<template>
  <SettingsPanel :selected="section" @select="selectSection" />
</template>
