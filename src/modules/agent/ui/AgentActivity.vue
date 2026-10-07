<script setup lang="ts">
import { computed } from "vue";
import type { AgentToolChip } from "../model/types.ts";
import IconChevron from "~icons/lucide/chevron-right";
import IconCheck from "~icons/lucide/check";
import IconLoader from "~icons/lucide/loader-circle";
import IconAlert from "~icons/lucide/circle-alert";
import IconTerminal from "~icons/lucide/terminal";
import IconSearch from "~icons/lucide/search";
import IconInfo from "~icons/lucide/info";
import IconPlay from "~icons/lucide/play";
import IconFolder from "~icons/lucide/folder";
const props = defineProps<{ tools: AgentToolChip[] }>();
const running = computed(() => props.tools.some((tool) => tool.status === "running"));
const failed = computed(() => rows.value.some((tool) => tool.status === "error"));
const labels: Record<string, string> = {
  list_commands: "Поиск команд",
  describe_command: "Описание команды",
  execute_command: "Вызов команды",
  bash: "Bash",
  find_projects: "Поиск проектов",
  inspect_path: "Обзор проекта",
  list_directory: "Обзор папки",
  add_project: "Добавление проекта",
  add_projects: "Добавление проектов",
  list_projects: "Список проектов",
  // Claude Code built-in tools
  Read: "Чтение файла",
  Edit: "Правка файла",
  MultiEdit: "Правка файла",
  Write: "Запись файла",
  Grep: "Поиск в файлах",
  Glob: "Поиск файлов",
  WebFetch: "Загрузка страницы",
  WebSearch: "Поиск в сети",
  Task: "Субагент",
  TodoWrite: "План задач",
};
function output(tool: AgentToolChip): {
  hint: string;
  text: string;
  status?: AgentToolChip["status"];
} {
  try {
    const data = JSON.parse(tool.detail);
    if (tool.name === "bash" && tool.status !== "running")
      return {
        hint: data.terminated ? "Прервано" : `Код ${data.exitCode ?? "—"}`,
        status: data.terminated || data.exitCode !== 0 ? "error" : "done",
        text: [data.stdout, data.stderr].filter(Boolean).join("\n") || "Без вывода",
      };
    if (tool.name === "list_commands" && Array.isArray(data.commands))
      return {
        hint: `${data.commands.length} найдено`,
        text:
          data.commands
            .map((c: { title: string; id: string }) => `${c.title}\n${c.id}`)
            .join("\n\n") || "Подходящих команд нет",
      };
    if (tool.name === "describe_command")
      return {
        hint: data.title ?? data.command ?? "",
        text: data.description
          ? [
              data.id,
              data.description,
              ...Object.entries(data.arguments ?? {}).map(([key, value]) => `${key}: ${value}`),
            ].join("\n\n")
          : tool.detail,
      };
    if (tool.name === "execute_command" && data.completed)
      return { hint: "Выполнено", text: "Команда выполнена в Projector." };
    return {
      hint:
        tool.status === "running"
          ? (data.command ?? data.query ?? data.path ?? data.file_path ?? data.pattern ?? "")
          : "",
      text: tool.detail,
    };
  } catch {
    return { hint: "", text: tool.detail };
  }
}
const rows = computed(() => props.tools.map((tool) => ({ ...tool, ...output(tool) })));
</script>

<template>
  <details class="activity" :class="{ working: running, failed }">
    <summary class="activity-summary">
      <IconLoader v-if="running" class="spin" aria-hidden="true" />
      <IconAlert v-else-if="failed" class="error-icon" aria-hidden="true" />
      <IconCheck v-else class="done-icon" aria-hidden="true" />
      <span>{{ running ? "Выполняет действия" : "Действия агента" }}</span>
      <span class="count">{{ tools.length }}</span>
      <IconChevron class="group-chevron" aria-hidden="true" />
    </summary>
    <div class="activity-list">
      <details v-for="row in rows" :key="row.id" class="tool" :class="row.status">
        <summary>
          <IconTerminal
            v-if="row.name.toLowerCase() === 'bash'"
            class="tool-icon"
            aria-hidden="true"
          />
          <IconSearch
            v-else-if="row.name === 'list_commands'"
            class="tool-icon"
            aria-hidden="true"
          />
          <IconInfo
            v-else-if="row.name === 'describe_command'"
            class="tool-icon"
            aria-hidden="true"
          />
          <IconPlay
            v-else-if="row.name === 'execute_command'"
            class="tool-icon"
            aria-hidden="true"
          />
          <IconFolder v-else class="tool-icon" aria-hidden="true" />
          <span class="tool-name">{{ labels[row.name] || row.name }}</span>
          <span class="tool-hint" :title="row.hint">{{ row.hint }}</span>
          <IconLoader
            v-if="row.status === 'running'"
            class="state-icon spin"
            aria-label="Выполняется"
          />
          <IconAlert
            v-else-if="row.status === 'error'"
            class="state-icon error-icon"
            aria-label="Ошибка"
          />
          <IconCheck v-else class="state-icon done-icon" aria-label="Завершено" />
          <IconChevron class="row-chevron" aria-hidden="true" />
        </summary>
        <pre>{{ row.text || "Ожидание результата…" }}</pre>
      </details>
    </div>
  </details>
</template>

<style scoped>
.activity {
  margin: 0 0 16px;
  max-width: 100%;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.activity:last-child {
  margin-bottom: 0;
}
summary {
  list-style: none;
  cursor: pointer;
}
summary::-webkit-details-marker {
  display: none;
}
summary:focus-visible {
  outline-offset: 3px;
  border-radius: var(--r-md);
}
.activity-summary {
  display: flex;
  width: fit-content;
  align-items: center;
  gap: 7px;
  padding: 5px 0;
}
.activity-summary:hover {
  color: var(--text);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.count {
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
  background: var(--bg-3);
  border-radius: var(--r-sm);
  min-width: 18px;
  text-align: center;
  padding: 2px 4px;
}
.group-chevron {
  width: 12px;
  transition: transform var(--t-fast);
}
.activity[open] > summary .group-chevron,
.tool[open] > summary .row-chevron {
  transform: rotate(90deg);
}
.activity-list {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  margin-top: 8px;
  overflow: hidden;
  background: var(--bg-sunken);
}
.tool + .tool {
  border-top: 1px solid var(--line);
}
.tool > summary {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px 12px;
  min-width: 0;
}
.tool > summary:hover {
  background: var(--bg-2);
}
.tool-name {
  color: var(--text-2);
  flex-shrink: 0;
}
.tool-hint {
  min-width: 0;
  flex: 1;
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-2xs);
}
.tool-icon {
  color: var(--muted);
}
.row-chevron {
  width: 11px;
  color: var(--faint);
}
.state-icon {
  width: 12px;
}
.done-icon {
  color: var(--run);
}
.error-icon {
  color: var(--err);
}
.spin {
  animation: spin 1s linear infinite;
}
pre {
  font: var(--fs-2xs)/1.7 var(--mono);
  color: var(--text-2);
  margin: 0;
  padding: 12px 14px;
  background: var(--bg-sunken);
  border-top: 1px solid var(--line);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 240px;
  overflow-y: auto;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
  .group-chevron {
    transition: none;
  }
}
@container (max-width: 400px) {
  .tool-hint {
    display: none;
  }
  .state-icon {
    margin-left: auto;
  }
}
</style>
