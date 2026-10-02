<script setup lang="ts">
import { useAgent } from "../model/session.ts";

const { turns, busy, error, phase, clear } = useAgent();
</script>

<template>
  <section v-if="turns.length || error || phase" class="log">
    <div class="head">
      <p class="phase" :class="{ err: error }">{{ error || phase || "агент" }}</p>
      <button type="button" class="close" :disabled="busy" @click="clear">закрыть</button>
    </div>
    <article v-for="turn in turns" :key="turn.id" :class="turn.role">
      <p class="who">{{ turn.role === "user" ? "вы" : "агент" }}</p>
      <p v-if="turn.text" class="text">{{ turn.text }}</p>
      <div v-if="turn.tools.length" class="tools">
        <span v-for="tool in turn.tools" :key="tool.id" class="chip" :class="tool.status">
          {{ tool.name }}
        </span>
      </div>
    </article>
  </section>
</template>

<style scoped>
.log {
  display: grid;
  gap: 8px;
  max-height: 180px;
  overflow: auto;
  padding-top: 4px;
}

.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.phase,
.who,
.close {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.close:hover:not(:disabled) {
  color: var(--text);
}

.phase.err {
  color: var(--err);
}

.text {
  margin: 2px 0 0;
  white-space: pre-wrap;
  font-size: 13px;
}

.tools {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.chip {
  font-family: var(--mono);
  font-size: 11px;
  color: var(--muted);
  border: 1px solid var(--line);
  border-radius: 3px;
  padding: 2px 7px;
}

.chip.running {
  color: var(--text);
}

.chip.error {
  color: var(--err);
}
</style>
