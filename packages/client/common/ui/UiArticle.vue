<script setup lang="ts">
withDefaults(defineProps<{ width?: number }>(), { width: 880 });
</script>

<template>
  <article class="article" :style="{ maxWidth: `${width}px` }"><slot /></article>
</template>

<style scoped>
.article {
  margin: 0 auto;
}
</style>
