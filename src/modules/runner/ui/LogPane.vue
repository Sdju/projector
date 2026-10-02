<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import type { LogLine } from "../../catalog/index.ts";

const props = defineProps<{
  lines: LogLine[];
}>();

const pane = ref<HTMLElement | null>(null);

watch(
  () => props.lines.length,
  async () => {
    await nextTick();
    if (!pane.value) return;
    pane.value.scrollTop = pane.value.scrollHeight;
  },
);
</script>

<template>
  <section class="logs">
    <header>логи</header>
    <pre ref="pane"><div v-for="(line, index) in lines" :key="`${line.at}-${index}`" :class="line.stream">{{ line.text }}</div><div v-if="!lines.length" class="empty">пока пусто</div></pre>
  </section>
</template>

<style scoped>
.logs {
  display: grid;
  gap: 8px;
}

header {
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

pre {
  margin: 0;
  max-height: 360px;
  overflow: auto;
  padding: 12px;
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 3px;
  color: #c8c4ba;
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
}

.stderr {
  color: var(--err);
}

.system {
  color: var(--muted);
}

.empty {
  color: var(--faint);
}
</style>
