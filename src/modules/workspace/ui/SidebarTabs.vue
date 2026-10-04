<script setup lang="ts">
import type { WorkspaceCapabilities } from "../../workspace-api/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import IconFiles from "~icons/lucide/files";
import IconSearch from "~icons/lucide/search";
import IconGit from "~icons/devicon/git";
import IconBot from "~icons/lucide/bot";
import IconRefresh from "~icons/lucide/rotate-cw";
import IconDocker from "~icons/lucide/container";
import IconIssues from "~icons/lucide/circle-dot";

export type SidebarSection = "files" | "search" | "git" | "issues" | "docker";
defineProps<{
  section: SidebarSection;
  gitCount: number;
  capabilities: Readonly<WorkspaceCapabilities>;
}>();
const emit = defineEmits<{
  "update:section": [section: SidebarSection];
  command: [id: string];
  refresh: [];
}>();
</script>

<template>
  <nav class="side-tabs" aria-label="Разделы проекта">
    <button
      :class="{ selected: section === 'files' }"
      :aria-pressed="section === 'files'"
      title="Файлы"
      aria-label="Файлы"
      @click="emit('update:section', 'files')"
    >
      <IconFiles aria-hidden="true" />
    </button>
    <button
      v-if="capabilities.search"
      :class="{ selected: section === 'search' }"
      :aria-pressed="section === 'search'"
      title="Поиск"
      aria-label="Поиск"
      @click="emit('update:section', 'search')"
    >
      <IconSearch aria-hidden="true" />
    </button>
    <button
      v-if="capabilities.git"
      :class="{ selected: section === 'git' }"
      :aria-pressed="section === 'git'"
      title="Git"
      :aria-label="gitCount ? `Git: ${gitCount} изменений` : 'Git'"
      @click="emit('update:section', 'git')"
    >
      <IconGit class="git-logo" aria-hidden="true" />
      <span v-if="gitCount" aria-hidden="true">{{ gitCount }}</span>
    </button>
    <button
      v-if="capabilities.issues"
      :class="{ selected: section === 'issues' }"
      :aria-pressed="section === 'issues'"
      title="Issues"
      aria-label="Issues"
      @click="emit('update:section', 'issues')"
    >
      <IconIssues aria-hidden="true" />
    </button>
    <button
      v-if="capabilities.docker"
      :class="{ selected: section === 'docker' }"
      :aria-pressed="section === 'docker'"
      title="Docker"
      aria-label="Docker"
      @click="emit('command', 'ide.docker.sidebar.open')"
    >
      <IconDocker aria-hidden="true" />
    </button>
    <div class="side-actions">
      <UiButton
        icon
        size="sm"
        v-if="capabilities.agent"
        title="Чат с агентом"
        aria-label="Чат с агентом"
        data-command="ide.workbench.agent.open"
        @click="emit('command', 'ide.workbench.agent.open')"
      >
        <IconBot aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        title="Обновить обзор"
        aria-label="Обновить обзор"
        @click="emit('refresh')"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
    </div>
  </nav>
</template>

<style scoped>
.side-tabs {
  display: flex;
  height: 40px;
  flex-shrink: 0;
  border-bottom: 1px solid var(--line);
  align-items: stretch;
  gap: var(--sp-3);
  padding: 0 var(--sp-3);
}
.side-tabs > button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: 24px;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
  border-bottom: 2px solid transparent;
  transition: color var(--t-fast);
}
.side-tabs > button:hover {
  color: var(--text);
}
.side-tabs > button.selected {
  color: var(--text);
  border-color: var(--focus);
}
.side-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
  flex-shrink: 0;
}
.side-tabs > button svg {
  width: 14px;
  height: 14px;
}
.git-logo :deep(path) {
  fill: currentColor;
}
.side-tabs span {
  color: var(--run);
  font: var(--fs-2xs) var(--mono);
}
@media (max-width: 600px) {
  .side-tabs {
    gap: 8px;
    padding: 0 8px;
  }
  .side-tabs > button {
    font-size: var(--fs-2xs);
  }
}
</style>
