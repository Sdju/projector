<script setup lang="ts">
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import UiIslandHeader from "../../../common/ui/UiIslandHeader.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiActionRow from "../../../common/ui/UiActionRow.vue";
import UiActionCopy from "../../../common/ui/UiActionCopy.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { computed, useId } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { useIdeCommands } from "../../ide/index.ts";
import { projectSettingsSection } from "../../catalog/index.ts";
import type { Project } from "../../project/index.ts";
import { useRunner } from "../model/session.ts";
import IconPlay from "~icons/lucide/play";
import IconStop from "~icons/lucide/square";
import IconChevron from "~icons/lucide/chevron-down";
import IconWindow from "~icons/lucide/panels-top-left";
import IconOpen from "~icons/lucide/external-link";
import IconContainer from "~icons/lucide/container";
import IconSettings from "~icons/lucide/settings-2";

/**
 * Запуск проекта в духе WebStorm: кнопка выполняет сценарий по умолчанию (или останавливает работающий),
 * а стрелка открывает остров со всеми сценариями. Рамка острова охватывает кнопку, как у других островов.
 */
const props = defineProps<{ project: Project }>();
const runner = useRunner();
const { api } = useIdeCommands();
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["button.main:not(:disabled)", "button:not(:disabled)"],
  returnFocus: ".arrow",
});
const { open, toggle, close } = menu;
const listId = useId();

const status = computed(() => props.project.runtime?.status ?? "idle");
const busy = computed(() => status.value === "running" || status.value === "starting");
const transitional = computed(() => status.value === "starting" || status.value === "stopping");
const defaultCommand = computed(
  () =>
    props.project.commands.find((item) => item.id === props.project.defaultCommandId) ??
    props.project.commands[0],
);
const runningName = computed(
  () => props.project.runtime?.commandName ?? defaultCommand.value?.name ?? "запуск",
);
const label = computed(() =>
  busy.value ? runningName.value : (defaultCommand.value?.name ?? "—"),
);
const stateLabel = computed(() =>
  busy.value ? "работает" : status.value === "stopping" ? "останавливается" : "",
);

const commands = useCommandScope(`project-run:${useId()}`, () => ({
  surface: "project-run",
  projectId: props.project.id,
  status: status.value,
}));
commands.scope.registerCommand({
  id: "ide.project.run.start",
  title: "Запустить сценарий проекта",
  description:
    "Запускает сценарий проекта (по умолчанию — основной) в сервере или в окне. Одновременно работает один сценарий.",
  arguments: { command: "string?: id сценария", mode: "server | window (по умолчанию server)" },
  enabled: () => !busy.value && !transitional.value && !!defaultCommand.value,
  run: async (value) => {
    const { command, mode } = commandArgs(value);
    await start(
      typeof command === "string" ? command : undefined,
      mode === "window" ? "window" : "server",
    );
  },
});
commands.scope.registerCommand({
  id: "ide.project.run.stop",
  title: "Остановить проект",
  description: "Останавливает запущенный сценарий проекта.",
  enabled: () => busy.value,
  run: () => runner.stop(props.project.id),
});
commands.scope.registerCommand({
  id: "ide.project.run.open",
  title: "Открыть запущенный проект",
  description: "Открывает работающий проект в браузере (server) или отдельном окне (window).",
  arguments: { mode: "server | window" },
  enabled: () => busy.value,
  run: (value) => {
    const { mode } = commandArgs(value);
    return runner.open(props.project.id, mode === "window" ? "window" : "server");
  },
});
commands.scope.registerCommand({
  id: "ide.project.run.scenarios.edit",
  title: "Редактировать сценарии запуска",
  description:
    "Открывает настройки проекта сразу на разделе «Сценарии»: названия и команды запуска, импорт из package.json.",
  run: () => editScenarios(),
});
commands.scope.registerCommand({
  id: "ide.project.run.menu.toggle",
  title: "Открыть или закрыть список сценариев запуска",
  description: "Показывает остров со всеми сценариями проекта, статусом и настройкой.",
  run: () => toggle(),
});

function start(commandId?: string, mode: "server" | "window" = "server") {
  return runner.start(props.project.id, commandId ?? props.project.defaultCommandId, mode);
}
/** Действие острова закрывает его: пользователь видит результат в кнопке запуска. */
async function act(run: () => unknown) {
  close();
  await run();
}
async function editScenarios() {
  close();
  projectSettingsSection.value = "scenarios";
  await api.executeCommand("ide.workbench.project.settings.open", undefined, {
    scope: `editor:${props.project.id}`,
  });
}
</script>

<template>
  <div :ref="menu.trigger" class="run" role="group" aria-label="Запуск проекта">
    <UiButton
      v-if="!busy"
      size="sm"
      class="main"
      :disabled="!defaultCommand || transitional"
      :title="defaultCommand ? `Запустить: ${defaultCommand.cmd}` : 'Нет сценариев запуска'"
      data-command="ide.project.run.start"
      @click="commands.run('ide.project.run.start')"
    >
      <IconPlay class="play" aria-hidden="true" />{{ label }}
    </UiButton>
    <UiButton
      v-else
      size="sm"
      class="main running"
      :disabled="status === 'stopping'"
      :title="`Остановить: ${runningName}`"
      data-command="ide.project.run.stop"
      @click="commands.run('ide.project.run.stop')"
    >
      <UiStatusDot
        class="dot"
        :tone="status === 'starting' || status === 'stopping' ? 'warning' : 'success'"
        aria-hidden="true"
      /><span>{{ label }}</span>
      <IconStop class="stop" aria-hidden="true" />
    </UiButton>
    <UiButton
      shape="icon"
      size="sm"
      class="arrow"
      title="Сценарии запуска"
      aria-label="Сценарии запуска"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="open ? menu.id : undefined"
      data-command="ide.project.run.menu.toggle"
      @click="commands.run('ide.project.run.menu.toggle')"
    >
      <IconChevron aria-hidden="true" />
    </UiButton>
  </div>
  <UiIsland :menu="menu" label="Сценарии запуска" :width="360">
    <UiIslandHeader chevron class="island-head" aria-label="Закрыть" @click="toggle(false)">
      <span class="head-label"
        ><UiStatusDot
          v-if="busy"
          class="dot"
          :tone="status === 'starting' || status === 'stopping' ? 'warning' : 'success'"
          aria-hidden="true"
        />{{ busy ? `${runningName} · ${stateLabel}` : "Запуск" }}</span
      >
    </UiIslandHeader>
    <div
      v-if="project.environment"
      class="env"
      :title="`${project.environment.image} · сеть: ${project.environment.network}`"
    >
      <IconContainer aria-hidden="true" />Docker · {{ project.environment.image }}
    </div>
    <UiStack
      flow="flex"
      gap="none"
      v-if="busy"
      class="group"
      role="group"
      aria-label="Работающий проект"
    >
      <UiActionRow
        v-if="project.runtime?.url"
        class="item"
        @click="act(() => commands.run('ide.project.run.open', { mode: 'server' }))"
      >
        <IconOpen aria-hidden="true" />
        <UiActionCopy title="Открыть в браузере" :description="project.runtime.url" />
      </UiActionRow>
      <UiActionRow
        class="item"
        @click="act(() => commands.run('ide.project.run.open', { mode: 'window' }))"
      >
        <IconWindow aria-hidden="true" />
        <UiActionCopy title="Открыть в окне" />
      </UiActionRow>
      <UiActionRow
        class="item"
        tone="danger"
        :disabled="status === 'stopping'"
        @click="act(() => commands.run('ide.project.run.stop'))"
      >
        <IconStop aria-hidden="true" />
        <UiActionCopy title="Остановить" />
      </UiActionRow>
    </UiStack>
    <UiStack flow="flex" gap="none" :id="listId" class="group" role="group" aria-label="Сценарии">
      <div v-for="command in project.commands" :key="command.id" class="scenario">
        <UiActionRow
          class="item main"
          :disabled="busy || transitional"
          :data-command="'ide.project.run.start'"
          @click="act(() => commands.run('ide.project.run.start', { command: command.id }))"
        >
          <IconPlay class="play" aria-hidden="true" />
          <UiActionCopy :title="command.name" :description="command.cmd" mono />
          <UiBadge v-if="command.id === project.defaultCommandId">основной</UiBadge>
        </UiActionRow>
        <UiButton
          shape="icon"
          size="sm"
          :disabled="busy || transitional"
          :title="`${command.name} в окне`"
          :aria-label="`Запустить ${command.name} в окне`"
          @click="
            act(() =>
              commands.run('ide.project.run.start', { command: command.id, mode: 'window' }),
            )
          "
        >
          <IconWindow aria-hidden="true" />
        </UiButton>
      </div>
      <p v-if="!project.commands.length" class="empty">Сценариев пока нет</p>
    </UiStack>
    <UiActionRow
      separator="before"
      tone="muted"
      class="item settings"
      data-command="ide.project.run.scenarios.edit"
      @click="commands.run('ide.project.run.scenarios.edit')"
    >
      <IconSettings aria-hidden="true" />Настроить сценарии…
    </UiActionRow>
  </UiIsland>
</template>

<style scoped>
.run {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.run .main {
  gap: var(--sp-2);
}
.run svg,
.item svg,
.env svg,
.scenario svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.play {
  color: var(--run);
}
.running .stop {
  color: var(--err);
}
.head-label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.env {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 2px var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.group + .group {
  border-top: 1px solid var(--line);
  margin-top: var(--sp-1);
  padding-top: var(--sp-1);
}
.scenario {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
}
.empty {
  margin: 0;
  padding: var(--sp-2);
  color: var(--muted);
}
</style>
