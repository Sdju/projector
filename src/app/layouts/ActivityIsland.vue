<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import UiActionRow from "../../common/ui/UiActionRow.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiIsland from "../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../common/ui/UiIslandLabel.vue";
import UiSpinner from "../../common/ui/UiSpinner.vue";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { useIslandMenu } from "../../common/utilities/island-menu.ts";
import {
  requestChatTab,
  requestJobTab,
  useAgentActivity,
  type AgentActivityItem,
} from "../../modules/agent/index.ts";
import { projectRoute, useProjects } from "../../modules/project/index.ts";
import { useRunner } from "../../modules/runner/index.ts";
import IconSquare from "~icons/lucide/square";
import IconBot from "~icons/lucide/bot";
import IconAlert from "~icons/lucide/circle-alert";

/** The counter in the header as an island: running projects and agents at work, one click away. */
const { projects } = useProjects();
const runner = useRunner();
const router = useRouter();
const { items: agents } = useAgentActivity();

const running = computed(() => projects.value.filter((item) => item.runtime?.status === "running"));
const total = computed(() => running.value.length + agents.value.length);
const summary = computed(
  () => `Запущено проектов: ${running.value.length}, агентов за работой: ${agents.value.length}`,
);
const nameOf = (id: string) => projects.value.find((item) => item.id === id)?.name ?? id;

const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["button.row"],
  returnFocus: ".trigger",
});

const commands = useCommandScope("activity", () => ({ surface: "activity" }));
commands.scope.registerCommand({
  id: "ide.activity.toggle",
  title: "Показать запущенные проекты и агентов",
  description:
    "Открывает или закрывает остров в правом верхнем углу: запущенные проекты (с остановкой) и агенты, которые сейчас работают.",
  run: () => menu.toggle(),
});

function openProject(path: string) {
  menu.close(false);
  void router.push(projectRoute(path));
}
function openAgent(agent: AgentActivityItem) {
  const project = projects.value.find((item) => item.id === agent.projectId);
  // A background job opens as its own tab of the project.
  if (agent.job) requestJobTab(agent.projectId, agent.job.id);
  // A chat opens as its tab (or gets the focus), which rejoins the answer the agent still writes.
  else requestChatTab(agent.projectId, agent.chat);
  if (project) openProject(project.path);
  else menu.close(false);
}
</script>

<template>
  <div :ref="(element) => (menu.trigger.value = element as HTMLElement)" class="activity">
    <button
      type="button"
      class="trigger count"
      :class="{ active: total }"
      :title="summary"
      :aria-label="summary"
      :aria-expanded="menu.open.value"
      :aria-controls="menu.id"
      @click="menu.toggle()"
    >
      <span class="count-dot" aria-hidden="true" />{{ total }}
    </button>
  </div>
  <UiIsland :menu="menu" label="Запущенные проекты и агенты" :width="320">
    <p v-if="!total" class="empty">Ничего не запущено</p>
    <template v-if="running.length">
      <UiIslandLabel>Проекты</UiIslandLabel>
      <UiInline
        v-for="project in running"
        :key="project.id"
        :gap="1"
        justify="normal"
        align="center"
      >
        <UiActionRow class="row" @click="openProject(project.path)">
          <span class="dot" aria-hidden="true" />
          <span class="name u-truncate">{{ project.name }}</span>
          <span class="sub u-truncate">{{ project.runtime?.commandName }}</span>
        </UiActionRow>
        <UiButton
          shape="icon"
          size="sm"
          title="Остановить проект"
          aria-label="Остановить проект"
          @click="runner.stop(project.id)"
        >
          <IconSquare aria-hidden="true" />
        </UiButton>
      </UiInline>
    </template>
    <template v-if="agents.length">
      <UiIslandLabel :divided="running.length > 0">Агенты</UiIslandLabel>
      <UiActionRow
        v-for="agent in agents"
        :key="agent.chat"
        class="row"
        :title="agent.topic"
        @click="openAgent(agent)"
      >
        <UiSpinner v-if="agent.busy" />
        <IconAlert v-else-if="agent.needsUser" class="alert" aria-hidden="true" />
        <IconBot v-else class="bot" aria-hidden="true" />
        <span class="name u-truncate">{{ agent.agent }} · {{ nameOf(agent.projectId) }}</span>
        <span v-if="agent.needsUser" class="badge">ждёт вас</span>
        <span class="sub u-truncate">{{
          agent.tasks ? `в фоне: ${agent.tasks}` : agent.topic
        }}</span>
      </UiActionRow>
    </template>
  </UiIsland>
</template>

<style scoped>
.trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  padding: 2px var(--sp-2);
  border: 0;
  border-radius: var(--r-full);
  background: none;
  color: var(--muted);
  font: inherit;
  font-family: var(--mono);
  font-size: var(--fs-xs);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.trigger:hover,
.trigger[aria-expanded="true"] {
  background: var(--hover);
  color: var(--text);
}
.count-dot,
.dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: var(--r-full);
  background: var(--faint);
}
.count.active .count-dot,
.dot {
  background: var(--run);
}
svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.row {
  min-width: 0;
  flex: 1;
}
.name {
  min-width: 0;
  flex: 0 1 auto;
}
.sub {
  min-width: 0;
  flex: 1;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.bot {
  color: var(--faint);
}
.alert,
.badge {
  color: var(--warn, var(--err));
}
.badge {
  flex-shrink: 0;
  font-size: var(--fs-2xs);
}
.empty {
  margin: 0;
  padding: var(--sp-2);
  color: var(--faint);
}
</style>
