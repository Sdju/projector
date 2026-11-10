<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import { useCommandScope, commandArgs } from "../../../../../common/utilities/commands.ts";
import {
  cancelAgentRun,
  requestChatTab,
  requestJobTab,
  requestNotifications,
  stopJob,
} from "../../../../agent-core/index.ts";
import { deviceBase } from "../../../../../common/utilities/device-url.ts";
import { projectRoute } from "../../../../project/index.ts";
import { currentDeviceId, useAgentInbox, type InboxGroup, type InboxItem } from "../model/inbox.ts";
import AgentInboxRow from "./AgentInboxRow.vue";
import IconRefresh from "~icons/lucide/rotate-cw";

const props = withDefaults(defineProps<{ scopeId?: string }>(), { scopeId: "agent-inbox" });
const router = useRouter();
const emit = defineEmits<{ navigate: [] }>();
const {
  items,
  groups,
  sources,
  loading,
  error,
  updatedAt,
  attention,
  working,
  finished,
  refresh,
  href,
} = useAgentInbox();
const busy = ref("");
const actionError = ref("");
const permission = ref(
  typeof Notification === "undefined" ? "unsupported" : Notification.permission,
);
const current = currentDeviceId();
const hubDevices = computed(() => sources.value.filter((source) => !source.current).length);
const updated = computed(() =>
  updatedAt.value
    ? new Date(updatedAt.value).toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "",
);

const commands = useCommandScope(props.scopeId, () => ({
  surface: "inbox",
  sources: sources.value.length,
}));
function find(value: unknown): InboxItem {
  const key = commandArgs(value).key;
  const item = items.value.find((entry) => entry.key === key);
  if (!item) throw new Error("Работа не найдена");
  return item;
}
commands.scope.registerCommand({
  id: "ide.inbox.refresh",
  title: "Обновить работы и уведомления",
  description:
    "Перечитывает фоновые задания и живые ходы агентов на этом устройстве и на подключённых устройствах Hub.",
  run: () => refresh(),
});
commands.scope.registerCommand({
  id: "ide.inbox.work.open",
  title: "Открыть работу агента",
  description:
    "Открывает проект и вкладку задания или чата, где можно продолжить работу и ответить на запрос.",
  arguments: { key: "string: ключ работы из центра работ" },
  run: (value) => open(find(value)),
});
commands.scope.registerCommand({
  id: "ide.inbox.work.stop",
  title: "Остановить работу агента",
  description: "Останавливает фоновое задание или прерывает живой ответ агента.",
  arguments: { key: "string: ключ работы из центра работ" },
  run: (value) => stop(find(value)),
});
commands.scope.registerCommand({
  id: "ide.inbox.notifications.allow",
  title: "Включить уведомления",
  description:
    "Просит браузер показывать уведомления о запросах агентов, пока страница Projector скрыта.",
  enabled: () => permission.value === "default",
  run: allowNotifications,
});

function sameDevice(item: InboxItem): boolean {
  return !item.sourceId || item.sourceId === current;
}
function open(item: InboxItem): void {
  if (!item.projectPath) return;
  if (!sameDevice(item)) {
    const link = href(item);
    if (link) location.assign(link);
    return;
  }
  if (item.kind === "job") requestJobTab(item.projectId, item.id);
  else if (item.chat) requestChatTab(item.projectId, item.chat);
  // The tab is requested for the workspace; a project that is not open yet mounts and opens it.
  const link = `${deviceBase()}${projectRoute(item.projectPath)}`;
  emit("navigate");
  void router.push(link);
}

async function stop(item: InboxItem): Promise<void> {
  if (busy.value) return;
  busy.value = item.key;
  actionError.value = "";
  try {
    const base = item.sourceBase || undefined;
    if (item.kind === "job") await stopJob(item.id, base);
    else await cancelAgentRun(item.id, base);
    await refresh();
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : "Не удалось остановить работу";
  } finally {
    busy.value = "";
  }
}

async function allowNotifications(): Promise<void> {
  await requestNotifications();
  permission.value = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

const shown = (group: InboxGroup) => group.items.filter((item) => item.category !== "finished");
const completed = (group: InboxGroup) => group.items.filter((item) => item.category === "finished");
</script>

<template>
  <div class="inbox">
    <header class="head">
      <UiInline justify="between" align="center">
        <strong class="title">Работы</strong>
        <UiButton
          shape="icon"
          size="sm"
          title="Обновить работы"
          aria-label="Обновить работы"
          data-command="ide.inbox.refresh"
          :busy="loading"
          @click="commands.run('ide.inbox.refresh')"
        >
          <IconRefresh aria-hidden="true" />
        </UiButton>
      </UiInline>
      <p class="counts">
        <span :class="{ alive: attention }">{{ attention }} ждут вас</span>
        <span>·</span>
        <span>{{ working }} работают</span>
        <span v-if="finished">· {{ finished }} завершились</span>
      </p>
      <p v-if="hubDevices" class="hub">
        Hub: {{ hubDevices + 1 }} {{ hubDevices + 1 === 1 ? "устройство" : "устройства" }}
      </p>
      <p class="updated">{{ updated ? `обновлено в ${updated}` : "" }}</p>
    </header>

    <UiLoader v-if="loading && !items.length" label="Читаю работы…" />
    <UiMessage v-if="error" tone="danger" size="xs" role="alert" class="message">{{
      error
    }}</UiMessage>
    <UiMessage v-if="actionError" tone="danger" size="xs" role="alert" class="message">{{
      actionError
    }}</UiMessage>
    <UiHint v-if="permission === 'default'" class="permission">
      Уведомления выключены. Разрешите их, чтобы узнать о запросе агента на другой вкладке.
      <UiButton
        size="sm"
        data-command="ide.inbox.notifications.allow"
        @click="commands.run('ide.inbox.notifications.allow')"
        >Включить</UiButton
      >
    </UiHint>
    <UiHint v-else-if="permission === 'denied'" class="permission">
      Уведомления запрещены в настройках браузера. Запросы останутся в этом списке.
    </UiHint>

    <p v-if="!loading && !items.length" class="empty">
      Ничего не работает и не ждёт ответа. Задания и чаты появятся здесь для всех проектов и
      устройств.
    </p>

    <section v-for="group in groups" :key="group.key" class="group">
      <header class="group-head">
        <span class="project">{{ group.projectName }}</span>
        <span v-if="group.sourceName && group.sourceName !== 'Это устройство'" class="source">{{
          group.sourceName
        }}</span>
        <span v-if="group.attention" class="group-alert">{{ group.attention }}</span>
      </header>
      <AgentInboxRow
        v-for="item in shown(group)"
        :key="item.key"
        :item="item"
        :busy="busy === item.key"
        @open="commands.run('ide.inbox.work.open', { key: item.key })"
        @stop="commands.run('ide.inbox.work.stop', { key: item.key })"
        @answered="refresh"
      />
      <details v-if="completed(group).length" class="done">
        <summary>Завершилось за сутки · {{ completed(group).length }}</summary>
        <AgentInboxRow
          v-for="item in completed(group)"
          :key="item.key"
          :item="item"
          :busy="busy === item.key"
          @open="commands.run('ide.inbox.work.open', { key: item.key })"
          @stop="commands.run('ide.inbox.work.stop', { key: item.key })"
          @answered="refresh"
        />
      </details>
    </section>
  </div>
</template>

<style scoped>
.inbox {
  display: grid;
  align-content: start;
  gap: var(--sp-3);
  min-width: 0;
  padding: var(--sp-3) var(--sp-2);
  color: var(--text);
  font-size: var(--fs-xs);
}
.head {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.title {
  font-size: var(--fs-sm);
  font-weight: 600;
}
.counts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.alive {
  color: var(--warn);
}
.hub,
.updated {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.message {
  margin: 0;
}
.permission {
  margin: 0;
  font-size: var(--fs-2xs);
}
.empty {
  margin: 0;
  padding: var(--sp-2);
  color: var(--faint);
  line-height: 1.45;
}
.group {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
.group-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--line);
}
.project {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.source {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.group-alert {
  min-width: 18px;
  padding: 0 5px;
  border-radius: var(--r-full);
  background: var(--warn);
  color: var(--bg);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.done {
  display: grid;
  gap: var(--sp-2);
}
.done summary {
  cursor: pointer;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.done[open] summary {
  margin-bottom: var(--sp-2);
}
.inbox :deep(svg) {
  width: 13px;
  height: 13px;
}
</style>
