<template>
  <div class="actions"><slot /></div>
</template>

<style scoped>
.actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-5);
}
</style>
