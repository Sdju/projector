<template>
  <kbd class="kbd"><slot /></kbd>
</template>

<style scoped>
.kbd {
  display: inline-block;
  padding: 1px 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--text-2);
  font: var(--fs-2xs) var(--mono);
}
</style>
