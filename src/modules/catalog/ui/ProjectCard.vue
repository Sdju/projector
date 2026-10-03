<script setup lang="ts">
import { computed } from "vue";
import { projectIconUrl, shortPath, statusLabel } from "../../project/index.ts";
import type { Project } from "../../project/index.ts";

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
      <img class="icon" :src="projectIconUrl(project)" alt="" />
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
  gap: var(--sp-2);
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--line);
}

.top {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}

.icon {
  width: 20px;
  height: 20px;
  border-radius: var(--r-sm);
  object-fit: cover;
  background: var(--bg-2);
  flex: 0 0 auto;
}

h2 {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 500;
  flex: 0 0 auto;
}

.meta {
  margin-left: auto;
  color: var(--muted);
  font-size: var(--fs-xs);
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: var(--r-full);
  background: var(--faint);
  flex: 0 0 auto;
}

.dot.running,
.dot.starting {
  background: var(--run);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--run) 22%, transparent);
}

.dot.error {
  background: var(--err);
}

.path,
.run {
  margin: 0;
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
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
  gap: var(--sp-2);
}
</style>
