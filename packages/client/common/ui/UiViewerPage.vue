<template>
  <div class="viewer-page"><slot /></div>
</template>

<style scoped>
.viewer-page {
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
  box-sizing: border-box;
}
</style>
