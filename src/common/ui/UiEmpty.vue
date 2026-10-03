<template>
  <p class="empty"><slot /></p>
</template>

<style scoped>
.empty {
  margin: 0;
  padding: var(--sp-5) var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
  text-align: center;
}
</style>
