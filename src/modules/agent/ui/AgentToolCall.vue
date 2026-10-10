<script setup lang="ts">
import { computed } from "vue";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import { formatToolInput, inputHint, isEditTool } from "../lib/tool-input.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import type { AgentToolChip, AgentToolView } from "../model/types.ts";
import IconChevron from "~icons/lucide/chevron-right";
import IconLoader from "~icons/lucide/loader-circle";
import IconAlert from "~icons/lucide/circle-alert";
import IconTerminal from "~icons/lucide/terminal";
import IconSearch from "~icons/lucide/search";
import IconInfo from "~icons/lucide/info";
import IconPlay from "~icons/lucide/play";
import IconFolder from "~icons/lucide/folder";
import IconFile from "~icons/lucide/file-text";

const props = defineProps<{ tool: AgentToolView }>();

/** The result as shown: the tools Projector knows get a readable summary instead of raw JSON. */
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
    return { hint: "", text: tool.detail };
  } catch {
    return { hint: "", text: tool.detail };
  }
}

const view = computed(() => {
  const tool = props.tool;
  const result = output(tool);
  const raw = tool.input ?? (tool.status === "running" ? tool.detail : "");
  return {
    label: toolLabel(tool.name),
    hint: inputHint(raw) || result.hint,
    status: result.status ?? tool.status,
    result: result.text,
    input: raw ? formatToolInput(tool.name, raw) : "",
    // While running, the input is all there is to show.
    diff: isEditTool(tool.name),
    showInput: Boolean(raw) && tool.status !== "running",
  };
});
const kind = computed(() => {
  const name = props.tool.name.toLowerCase();
  if (name === "bash") return IconTerminal;
  if (name === "list_commands") return IconSearch;
  if (name === "describe_command") return IconInfo;
  if (name === "execute_command") return IconPlay;
  if (["read", "write", "edit", "multiedit"].includes(name)) return IconFile;
  return IconFolder;
});
</script>

<template>
  <details class="tool" :class="view.status">
    <summary>
      <component :is="kind" class="tool-icon" aria-hidden="true" />
      <span class="tool-name">{{ view.label }}</span>
      <span class="tool-hint" :title="view.hint">{{ view.hint }}</span>
      <IconLoader
        v-if="tool.status === 'running'"
        class="state-icon spin"
        aria-label="Выполняется"
      />
      <IconAlert
        v-else-if="view.status === 'error'"
        class="state-icon error-icon"
        aria-label="Ошибка"
      />
      <IconChevron class="row-chevron" aria-hidden="true" />
    </summary>
    <div v-if="view.showInput" class="io-label">Вход</div>
    <AgentCodeBlock v-if="view.showInput" :text="view.input" :diff="view.diff" />
    <div v-if="view.showInput" class="io-label">Результат</div>
    <AgentCodeBlock :text="view.result || 'Ожидание результата…'" />
    <div v-if="tool.children?.length" class="nested">
      <div class="io-label">Вызовы субагента: {{ tool.children.length }}</div>
      <AgentToolCall v-for="child in tool.children" :key="child.id" :tool="child" />
    </div>
  </details>
</template>

<style scoped>
.tool {
  color: var(--muted);
  font-size: var(--fs-2xs);
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
.tool > summary {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-1) 0;
  min-width: 0;
}
.tool > summary:hover {
  color: var(--text);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.tool-name {
  flex-shrink: 0;
}
.tool-hint {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--faint);
}
.row-chevron {
  width: 11px;
  color: var(--faint);
  transition: transform var(--t-fast);
}
.tool[open] > summary .row-chevron {
  transform: rotate(90deg);
}
.state-icon {
  width: 12px;
}
.error-icon {
  color: var(--err);
}
.spin {
  animation: spin 1s linear infinite;
}
.io-label {
  margin-top: var(--sp-1);
  color: var(--faint);
}
.nested {
  margin: var(--sp-1) 0 0 var(--sp-2);
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
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
  .row-chevron {
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
