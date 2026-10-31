<script setup lang="ts">
import UiDisclosureSummary from "../../../common/ui/UiDisclosureSummary.vue";
import { computed, nextTick, ref, watch } from "vue";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import { formatElapsed, useElapsedClock } from "../lib/elapsed.ts";
import {
  formatToolInput,
  inputHint,
  isEditTool,
  parseToolInput,
  toolFilePath,
} from "../lib/tool-input.ts";
import { toolLabel } from "../lib/tool-labels.ts";
import { lineCount, relativePath, toolVisual } from "../lib/tool-visual.ts";
import type { AgentToolChip, AgentToolView } from "../model/types.ts";
import IconChevron from "~icons/lucide/chevron-right";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconTerminal from "~icons/lucide/terminal";
import IconSearch from "~icons/lucide/search";
import IconFolder from "~icons/lucide/folder";
import IconFile from "~icons/lucide/file-text";
import IconGlobe from "~icons/lucide/globe";
import IconBot from "~icons/lucide/bot";

const props = defineProps<{ tool: AgentToolView; root?: string }>();
const emit = defineEmits<{ open: [path: string] }>();

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

const visual = computed(() => toolVisual(props.tool.name, props.tool.kind));
const data = computed(() => parseToolInput(props.tool.input ?? ""));
const path = computed(() => toolFilePath(props.tool.input ?? ""));
const shownPath = computed(() => relativePath(path.value, props.root));
const command = computed(() => (typeof data.value?.command === "string" ? data.value.command : ""));
const written = computed(() => (typeof data.value?.content === "string" ? data.value.content : ""));

const view = computed(() => {
  const tool = props.tool;
  const result = output(tool);
  const raw = tool.input ?? (tool.status === "running" ? tool.detail : "");
  const kind = visual.value;
  const running = tool.status === "running";
  return {
    label: toolLabel(tool.name),
    hint: path.value ? shownPath.value : command.value || inputHint(raw) || result.hint,
    path: path.value ? shownPath.value : "",
    status: result.status ?? tool.status,
    result: running ? "" : result.text,
    resultHint: running ? "" : result.hint,
    live: running ? (tool.output ?? "") : "",
    input: raw ? formatToolInput(tool.name, raw) : "",
    diff: isEditTool(tool.name),
    running,
    // A read has no input worth showing: the content is the result.
    showInput: Boolean(raw) && kind !== "read",
    body: kind === "write" ? written.value : "",
    badge: running
      ? ""
      : kind === "write"
        ? `+${lineCount(written.value)}`
        : kind === "read"
          ? `${lineCount(result.text)} стр.`
          : kind === "bash"
            ? result.hint
            : "",
  };
});
const icon = computed(() => {
  switch (visual.value) {
    case "bash":
      return IconTerminal;
    case "search":
      return IconSearch;
    case "web":
      return IconGlobe;
    case "task":
      return IconBot;
    case "read":
    case "write":
    case "edit":
      return IconFile;
    default:
      return IconFolder;
  }
});

// A command opens as it runs so its output is read live; a failure and a short read open too.
const opened = ref(visual.value === "bash" && props.tool.status === "running");
watch(
  () => props.tool.status,
  (status) => {
    if (status === "running" && visual.value === "bash") opened.value = true;
    else if (status === "error") opened.value = true;
    else if (status === "done" && visual.value === "read" && lineCount(view.value.result) <= 80)
      opened.value = true;
    // A finished command keeps its row tidy; the output stays one click away.
    else if (status === "done" && visual.value === "bash" && view.value.status !== "error")
      opened.value = false;
  },
);
const toggle = (event: Event) => {
  opened.value = (event.target as HTMLDetailsElement).open;
};

// Live output keeps the newest line in view, like a terminal.
const body = ref<HTMLElement>();
watch(
  () => props.tool.output,
  async () => {
    await nextTick();
    const blocks = body.value?.querySelectorAll("pre");
    const pre = blocks?.[blocks.length - 1];
    if (pre) pre.scrollTop = pre.scrollHeight;
  },
);

// A call that runs shows the time so far, a finished one how long it took.
const now = useElapsedClock();
const time = computed(() => {
  const tool = props.tool;
  if (tool.startedAt === undefined) return "";
  if (tool.status === "running") return formatElapsed(now.value - tool.startedAt);
  if (tool.endedAt === undefined) return "";
  return formatElapsed(tool.endedAt - tool.startedAt);
});
const timeTitle = computed(() =>
  props.tool.status === "running" ? `Выполняется ${time.value}` : `Длительность: ${time.value}`,
);
</script>

<template>
  <details
    class="tool"
    :class="[view.status, { streaming: view.running && view.live }]"
    :open="opened"
    @toggle="toggle"
  >
    <UiDisclosureSummary variant="padded">
      <component :is="icon" class="tool-icon" aria-hidden="true" />
      <span class="tool-name u-truncate" :title="view.label">{{ view.label }}</span>
      <span class="tool-hint u-truncate" :title="view.hint">{{ view.hint }}</span>
      <span v-if="view.badge" class="tool-badge" :class="{ failed: view.status === 'error' }">{{
        view.badge
      }}</span>
      <span v-if="time" class="tool-time" :title="timeTitle">{{ time }}</span>
      <UiSpinner v-if="tool.status === 'running'" class="state-icon" label="Выполняется" />
      <IconAlert
        v-else-if="view.status === 'error'"
        class="state-icon error-icon"
        aria-label="Ошибка"
      />
      <IconChevron class="row-chevron" aria-hidden="true" />
    </UiDisclosureSummary>

    <div ref="body" class="tool-body">
      <template v-if="visual === 'read'">
        <div v-if="view.path" class="file-row">
          <span class="io-label">Файл</span>
          <button
            type="button"
            class="file u-truncate"
            :title="`Открыть ${view.path}`"
            @click="emit('open', view.path)"
          >
            {{ view.path }}
          </button>
        </div>
        <div class="io-label">{{ view.status === "error" ? "Ошибка" : "Содержимое" }}</div>
        <AgentCodeBlock
          :path="path"
          :text="
            view.result ||
            (view.running ? 'Ожидание результата…' : 'Файл пуст или ничего не вернул')
          "
        />
      </template>

      <template v-else-if="visual === 'write'">
        <div v-if="view.path" class="file-row">
          <span class="io-label">Куда</span>
          <button
            type="button"
            class="file u-truncate"
            :title="`Открыть ${view.path}`"
            @click="emit('open', view.path)"
          >
            {{ view.path }}
          </button>
        </div>
        <div class="io-label">Содержимое</div>
        <AgentCodeBlock :text="view.body || 'Пустой файл'" />
        <template v-if="view.result">
          <div class="io-label">Результат</div>
          <AgentCodeBlock :text="view.result" />
        </template>
      </template>

      <template v-else-if="visual === 'bash'">
        <div class="io-label">Команда</div>
        <AgentCodeBlock :text="view.input || '…'" />
        <div class="io-label">{{ view.running ? "Вывод" : "Результат" }}</div>
        <AgentCodeBlock
          :text="view.live || view.result || (view.running ? 'Ожидание вывода…' : 'Без вывода')"
        />
      </template>

      <template v-else>
        <template v-if="view.showInput">
          <div class="io-label">Вход</div>
          <AgentCodeBlock :text="view.input" :diff="view.diff" />
        </template>
        <div class="io-label">Результат</div>
        <AgentCodeBlock
          :text="view.result || (view.running ? 'Ожидание результата…' : 'Без вывода')"
        />
      </template>
    </div>

    <div v-if="tool.children?.length" class="nested">
      <div class="io-label">Вызовы субагента: {{ tool.children.length }}</div>
      <AgentToolCall
        v-for="child in tool.children"
        :key="child.id"
        :tool="child"
        :root="root"
        @open="emit('open', $event)"
      />
    </div>
  </details>
</template>

<style scoped>
.tool {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
/* ACP agents name a call with its whole command line: it must shrink, not push the row wide. */
.tool-name {
  min-width: 0;
  flex: 0 1 auto;
}
.tool-hint {
  min-width: 0;
  flex: 1;
  color: var(--faint);
}
.tool-badge {
  flex-shrink: 0;
  color: var(--faint);
  font-family: var(--mono);
  white-space: nowrap;
}
.tool-badge.failed {
  color: var(--err);
}
.tool-time {
  flex-shrink: 0;
  color: var(--faint);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
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
.io-label {
  margin-top: var(--sp-1);
  color: var(--faint);
}
.file-row {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  min-width: 0;
}
.file-row .io-label {
  flex-shrink: 0;
  margin-top: 0;
}
.file {
  min-width: 0;
  max-width: 100%;
  padding: 0;
  text-align: left;
  font: var(--fs-2xs) var(--mono);
  color: var(--text-2);
}
.file:hover {
  color: var(--text);
  text-decoration: underline;
}
.nested {
  margin: var(--sp-1) 0 0 var(--sp-2);
  padding-left: var(--sp-3);
  border-left: 1px solid var(--line);
}
@media (prefers-reduced-motion: reduce) {
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
