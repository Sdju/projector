<script setup lang="ts">
defineProps<{ items: { title: string; text?: string; done?: boolean }[] }>();
</script>

<template>
  <ol class="steps">
    <li v-for="(item, index) in items" :key="item.title" :class="{ done: item.done }">
      <span class="dot">{{ item.done ? "✓" : index + 1 }}</span>
      <div>
        <strong>{{ item.title }}</strong>
        <p v-if="item.text">{{ item.text }}</p>
      </div>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  display: grid;
  gap: var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
li {
  display: flex;
  gap: var(--sp-3);
  font-size: var(--fs-xs);
}
.dot {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  color: var(--muted);
}
.done .dot {
  background: var(--run);
  border-color: var(--run);
  color: var(--bg);
}
p {
  margin: 2px 0 0;
  color: var(--muted);
}
</style>
