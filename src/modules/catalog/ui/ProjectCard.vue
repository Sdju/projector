<script setup lang="ts">
import { computed } from "vue";
import { shortPath, statusLabel } from "../format.ts";
import type { Project } from "../model/types.ts";

const props = defineProps<{
  project: Project;
}>();

const status = computed(() => props.project.runtime?.status ?? "idle");
const busy = computed(() => status.value === "running" || status.value === "starting");
</script>

<template>
  <article class="card" :class="status">
    <div class="top">
      <span class="dot" :class="status" />
      <img class="icon" :src="`/api/projects/${project.id}/icon`" alt="" />
      <h2>{{ project.name }}</h2>
      <p class="path">{{ shortPath(project.path) }}</p>
      <span class="meta">{{ statusLabel(status) }}</span>
    </div>
    <p v-if="busy && project.runtime?.commandName" class="run">
      {{ project.runtime.commandName }}
      <template v-if="project.runtime.url"> · {{ project.runtime.url }}</template>
    </p>
    <div class="actions">
      <slot />
    </div>
  </article>
</template>

<style scoped>
.card {
  display: grid;
  gap: 6px;
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--line);
}

.top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.icon {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  object-fit: cover;
  background: var(--bg-2);
  flex: 0 0 auto;
}

h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.02em;
  flex: 0 0 auto;
}

.meta {
  margin-left: auto;
  color: var(--faint);
  font-size: 12px;
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--faint);
  flex: 0 0 auto;
}

.dot.running,
.dot.starting {
  background: var(--run);
}

.dot.error {
  background: var(--err);
}

.path,
.run {
  margin: 0;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
}

.path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
</style>
