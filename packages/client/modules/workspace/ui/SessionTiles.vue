<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import { useSessionLaunchers } from "../lib/session-launchers.ts";

/**
 * Пустая группа терминалов: те же варианты запуска, что и в острове «+», крупными плитками.
 * Запуск идёт теми же IDE-командами; последний выбор попадает на split-кнопку шапки.
 */
const props = defineProps<{ busy: boolean; agent?: boolean }>();
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const { rows, builtin, commandOf, isChat, launch, openBuiltin } = useSessionLaunchers({
  agent: () => props.agent,
  busy: () => props.busy,
  command: (id, args) => emit("command", id, args),
});
function tone(tone: "spare" | "normal" | "hot" | "over" | null | undefined) {
  return tone === "spare"
    ? "info"
    : tone === "hot"
      ? "warning"
      : tone === "over"
        ? "danger"
        : "neutral";
}
</script>

<template>
  <div class="tiles-host">
    <div class="tiles" role="group" aria-label="Новая сессия">
      <p class="lead">
        <ProjectorIcon name="plus" aria-hidden="true" /> Новая сессия в папке проекта
      </p>
      <div class="grid">
        <button
          v-for="row in rows"
          :key="row.program"
          type="button"
          class="tile"
          :disabled="busy"
          :data-command="commandOf(row.program)"
          @click="launch(row.program)"
        >
          <ProjectorIcon :name="row.icon" class="tile-icon" aria-hidden="true" />
          <span class="tile-copy">
            <span class="tile-title">{{ row.title }}</span>
            <span class="tile-caption">{{
              isChat(row.program) ? "Графический чат" : row.caption
            }}</span>
          </span>
          <UiBadge v-if="row.usage" mono :tone="tone(row.usage.tone)"
            >{{ row.usage.remaining }}%</UiBadge
          >
        </button>
        <button
          v-if="builtin"
          type="button"
          class="tile"
          data-command="ide.workbench.agent.open"
          @click="openBuiltin"
        >
          <ProjectorIcon :name="builtin.icon" class="tile-icon" aria-hidden="true" />
          <span class="tile-copy">
            <span class="tile-title">{{ builtin.title }}</span>
            <span class="tile-caption">{{ builtin.caption }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiles-host {
  container-type: inline-size;
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: auto;
  padding: var(--sp-4);
}
.tiles {
  display: grid;
  gap: var(--sp-3);
  width: min(100%, 520px);
}
.lead {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.lead svg {
  width: 14px;
  height: 14px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-2);
}
@container (max-width: 380px) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
.tile {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
  color: var(--text);
  text-align: left;
  transition:
    background var(--t-fast),
    border-color var(--t-fast);
}
.tile:hover:not(:disabled),
.tile:focus-visible {
  border-color: var(--line-strong);
  background: var(--hover);
}
.tile:disabled {
  opacity: 0.55;
}
.tile-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  color: var(--muted);
}
.tile-copy {
  display: grid;
  flex: 1;
  gap: 2px;
  min-width: 0;
}
.tile-title {
  font: 600 var(--fs-xs) var(--sans);
}
.tile-caption {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
