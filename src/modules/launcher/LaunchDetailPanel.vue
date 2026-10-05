<script setup lang="ts">
import type {
  LaunchAction,
  LaunchDetail,
  LaunchItem,
} from "../../../core/modules/launcher/index.ts";

defineProps<{
  item: LaunchItem;
  actions: LaunchAction[];
  info?: LaunchDetail["info"];
  failure?: LaunchDetail["failure"];
  loading: boolean;
}>();
const index = defineModel<number>("index", { required: true });
defineEmits<{ launch: [action: LaunchAction] }>();
</script>

<template>
  <div class="actions-panel" role="listbox" :aria-label="`Действия: ${item.name}`">
    <div class="panel-title">
      <span class="back" aria-hidden="true">←</span> {{ item.name }}
      <span v-if="loading" aria-hidden="true">⋯</span>
    </div>
    <div v-if="info" class="info-card">
      <div class="info-path">{{ info.path }}</div>
      <div class="info-state">
        <span class="status-dot" :class="info.state" aria-hidden="true" />{{ info.stateLabel
        }}<template v-if="info.command"> · {{ info.command }}</template
        ><template v-if="info.url"> · {{ info.url }}</template>
      </div>
      <div v-if="info.docker" class="info-docker">{{ info.docker }}</div>
    </div>
    <button
      v-for="(action, position) in actions"
      :key="`${action.id}:${action.arg ?? ''}`"
      role="option"
      class="result"
      :class="{ selected: position === index }"
      :aria-selected="position === index"
      tabindex="-1"
      @mousemove="index = position"
      @click="$emit('launch', action)"
    >
      <span class="name">{{ action.title }}</span>
      <span v-if="position === index" class="enter" aria-hidden="true">↵</span>
    </button>
    <div v-if="failure" class="failure" role="alert">
      <div class="failure-title">
        «{{ failure.command }}» завершилась с ошибкой<template v-if="failure.exitCode !== null">
          (код {{ failure.exitCode }})</template
        >
      </div>
      <pre v-if="failure.output">{{ failure.output }}</pre>
      <div v-else class="failure-empty">Вывод терминала пуст.</div>
    </div>
  </div>
</template>

<style scoped>
.actions-panel {
  padding: var(--sp-2);
  border-top: 1px solid var(--line);
}
.panel-title {
  padding: var(--sp-1) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.back {
  color: var(--muted);
}
.result {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-3);
  text-align: left;
  border-radius: var(--r-md);
}
.result.selected {
  background: var(--hover);
}
.name {
  font-size: var(--fs-md);
}
.enter {
  color: var(--muted);
  white-space: nowrap;
}
.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: var(--sp-2);
  border-radius: var(--r-full);
  background: var(--run);
}
.status-dot.error {
  background: var(--err);
}
.status-dot.stopping {
  background: var(--muted);
}
.status-dot.idle {
  background: var(--faint);
}
.info-card {
  display: grid;
  gap: var(--sp-1);
  margin: 0 var(--sp-2) var(--sp-2);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  font-size: var(--fs-xs);
}
.info-path {
  font-family: var(--mono);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.info-docker {
  color: var(--muted);
}
.failure {
  margin: var(--sp-2) var(--sp-2) var(--sp-1);
  padding: var(--sp-3);
  border: 1px solid color-mix(in srgb, var(--err) 45%, var(--line));
  border-radius: var(--r-md);
}
.failure-title {
  color: var(--err);
  font-size: var(--fs-xs);
}
.failure pre {
  max-height: 220px;
  margin: var(--sp-2) 0 0;
  overflow: auto;
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.failure-empty {
  margin-top: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
