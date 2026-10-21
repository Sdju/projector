<script setup lang="ts">
import { useEditorTopbarTarget } from "../lib/editor-topbar.ts";

/** Элементы редактора в верхней панели вкладки; без панели ничего не рисуются. */
const target = useEditorTopbarTarget();
// В шаблоне ref разворачивается: `target` там — уже сам элемент или null.
</script>

<template>
  <Teleport v-if="target" :to="target"><slot /></Teleport>
</template>
