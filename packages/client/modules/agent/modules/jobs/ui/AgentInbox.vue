<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { useRouter } from "vue-router";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiLoader from "../../../../../common/ui/UiLoader.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import UiSectionRefresh, { sectionRefreshKey } from "../../../../../common/ui/UiSectionRefresh.vue";
import { useCommandScope, commandArgs } from "../../../../../common/utilities/commands.ts";
import { notify, reportError } from "../../../../../common/utilities/notice.ts";
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
import AgentInboxNotice from "./AgentInboxNotice.vue";
import AgentInboxRow from "./AgentInboxRow.vue";
import IconRefresh from "~icons/lucide/rotate-cw";

const props = withDefaults(defineProps<{ scopeId?: string }>(), {
  scopeId: "agent-inbox",
});
const hostRefresh = inject(sectionRefreshKey, null);
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
  unread,
  working,
  finished,
  notices,
  noticeUnread,
  isNoticeRead,
  markNoticeRead,
  markAllNoticesRead,
  restoreNotice,
  isUnread,
  isAttention,
  markRead,
  markAllRead,
  refresh,
  href,
} = useAgentInbox();
const busy = ref("");
const busyNotice = ref("");
const userRefreshing = ref(false);
const actionError = ref("");
const pending = computed(() => loading.value || userRefreshing.value);
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
async function reload(): Promise<void> {
  if (userRefreshing.value) return;
  userRefreshing.value = true;
  try {
    await refresh();
  } finally {
    userRefreshing.value = false;
  }
}
defineExpose({ refresh: reload, refreshing: pending });
function find(value: unknown): InboxItem {
  const key = commandArgs(value).key;
  const item = items.value.find((entry) => entry.key === key);
  if (!item) throw new Error("Работа не найдена");
  return item;
}
function findNotice(value: unknown) {
  const key = commandArgs(value).key;
  const notice = notices.value.find((entry) => entry.id === key);
  if (!notice) throw new Error("Уведомление не найдено");
  return notice;
}
/** Page-relative route; vue-router adds the current Hub device prefix itself. */
function noticeRoute(notice: (typeof notices.value)[number]): string {
  if (!notice.projectPath) return notice.href ?? "/settings?section=plugins";
  const section = notice.section ? `?settings=${encodeURIComponent(notice.section)}` : "";
  return `${projectRoute(notice.projectPath)}${section}`;
}
commands.scope.registerCommand({
  id: "ide.inbox.refresh",
  title: "Обновить работы и уведомления",
  description:
    "Перечитывает фоновые задания и живые ходы агентов на этом устройстве и на подключённых устройствах Hub.",
  run: () => reload(),
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
  id: "ide.inbox.work.read",
  title: "Отметить уведомление прочитанным",
  description: "Отмечает завершённое задание или ответ агента прочитанным в центре работ.",
  arguments: { key: "string: ключ работы из центра работ" },
  run: (value) => markRead(find(value)),
});
commands.scope.registerCommand({
  id: "ide.inbox.notice.open",
  title: "Открыть настройки доверия",
  description:
    "Открывает раздел плагинов или настройки проекта, где можно подтвердить доверие к изменившемуся файлу или отключить его.",
  arguments: { key: "string: ключ уведомления доверия" },
  run: (value) => {
    const notice = findNotice(value);
    markNoticeRead(notice.id);
    void router.push(noticeRoute(notice));
  },
});
commands.scope.registerCommand({
  id: "ide.inbox.notice.trust",
  palette: false,
  title: "Вернуть доверие из уведомления",
  description:
    "Подтверждает текущее содержимое плагина или проектного файла из уведомления и снова включает его.",
  arguments: { key: "string: ключ уведомления доверия" },
  enabled: () => !busyNotice.value,
  run: (value) => trustNotice(findNotice(value)),
});
commands.scope.registerCommand({
  id: "ide.inbox.notice.read",
  title: "Отметить уведомление доверия прочитанным",
  description: "Снимает пометку непрочитанного с уведомления об отозванном доверии.",
  arguments: { key: "string: ключ уведомления доверия" },
  run: (value) => markNoticeRead(findNotice(value).id),
});
commands.scope.registerCommand({
  id: "ide.inbox.read.all",
  title: "Отметить все уведомления прочитанными",
  description:
    "Снимает пометку непрочитанного со всех завершённых работ агентов и уведомлений плагинов.",
  enabled: () => hasAcknowledgeable.value,
  run: () => {
    markAllRead();
    markAllNoticesRead();
  },
});
commands.scope.registerCommand({
  id: "ide.inbox.notifications.allow",
  title: "Включить уведомления",
  description:
    "Просит браузер показывать уведомления о запросах агентов, пока страница Projector скрыта.",
  enabled: () => permission.value === "default",
  run: allowNotifications,
});

async function trustNotice(notice: (typeof notices.value)[number]): Promise<void> {
  if (busyNotice.value) return;
  busyNotice.value = notice.id;
  try {
    await restoreNotice(notice.id);
    notify(null, "Доверие восстановлено");
  } catch (cause) {
    reportError(cause instanceof Error ? cause.message : "Не удалось вернуть доверие");
  } finally {
    busyNotice.value = "";
  }
}

function confirmTrust(notice: (typeof notices.value)[number]): void {
  let question: string;
  if (notice.scope === "plugin")
    question = `Доверять новому содержимому плагина «${notice.name}»? Его код снова будет выполняться.`;
  else if (notice.kind === "devcontainer")
    question = `Доверять изменённому devcontainer.json проекта «${notice.name}»? Команды контейнера снова будут выполняться.`;
  else
    question = `Доверять изменённому файлу проекта «${notice.name}»? Прежнее подтверждение будет заменено текущим содержимым.`;
  if (window.confirm(question)) commands.run("ide.inbox.notice.trust", { key: notice.id });
}

function sameDevice(item: InboxItem): boolean {
  return !item.sourceId || item.sourceId === current;
}
function open(item: InboxItem): void {
  if (!item.projectPath) return;
  markRead(item);
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

const canAcknowledge = (item: InboxItem) =>
  isUnread(item) ||
  (item.category === "attention" && item.pending.length === 0 && isAttention(item));
const hasAcknowledgeable = computed(
  () => noticeUnread.value > 0 || items.value.some(canAcknowledge),
);
const shown = (group: InboxGroup) =>
  group.items.filter((item) => item.category === "working" || isAttention(item) || isUnread(item));
const completed = (group: InboxGroup) =>
  group.items.filter(
    (item) => item.category !== "working" && !isAttention(item) && !isUnread(item),
  );
const groupBadge = (group: InboxGroup) =>
  group.items.filter((item) => isAttention(item) || isUnread(item)).length;
</script>

<template>
  <div class="inbox">
    <header class="head">
      <UiInline justify="between" align="center">
        <strong class="title">Работы</strong>
        <UiInline :gap="1" align="center">
          <UiButton
            v-if="hasAcknowledgeable"
            size="sm"
            data-command="ide.inbox.read.all"
            @click="commands.run('ide.inbox.read.all')"
          >
            Прочитать всё
          </UiButton>
          <UiSectionRefresh />
          <UiButton
            v-if="!hostRefresh"
            shape="icon"
            size="sm"
            title="Обновить работы"
            aria-label="Обновить работы"
            data-command="ide.inbox.refresh"
            :busy="pending"
            @click="commands.run('ide.inbox.refresh')"
          >
            <IconRefresh aria-hidden="true" />
          </UiButton>
        </UiInline>
      </UiInline>
      <p class="counts">
        <span :class="{ alive: attention }">{{ attention }} ждут вас</span>
        <span>·</span>
        <span>{{ working }} работают</span>
        <span v-if="noticeUnread" class="alive">· {{ noticeUnread }} по доверию</span>
        <span v-if="unread">· <span class="done-alive">{{ unread }} завершили</span></span>
        <span v-else-if="finished">· {{ finished }} завершились</span>
      </p>
      <p v-if="hubDevices" class="hub">
        Hub: {{ hubDevices + 1 }} {{ hubDevices + 1 === 1 ? "устройство" : "устройства" }}
      </p>
      <p class="updated">{{ updated ? `обновлено в ${updated}` : "" }}</p>
    </header>

    <UiLoader
      v-if="!hostRefresh && loading && !items.length && !notices.length"
      label="Читаю работы…"
    />
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

    <p v-if="!loading && !items.length && !notices.length" class="empty">
      Ничего не работает и не ждёт ответа. Задания и чаты появятся здесь для всех проектов и
      устройств.
    </p>

    <section v-if="notices.length" class="group">
      <header class="group-head">
        <span class="project">Доверие</span>
        <span v-if="noticeUnread" class="group-alert">{{ noticeUnread }}</span>
      </header>
      <AgentInboxNotice
        v-for="notice in notices"
        :key="notice.id"
        :notice="notice"
        :unread="!isNoticeRead(notice)"
        :busy="busyNotice === notice.id"
        @open="commands.run('ide.inbox.notice.open', { key: notice.id })"
        @trust="confirmTrust(notice)"
        @read="commands.run('ide.inbox.notice.read', { key: notice.id })"
      />
    </section>

    <section v-for="group in groups" :key="group.key" class="group">
      <header class="group-head">
        <span class="project">{{ group.projectName }}</span>
        <span v-if="group.sourceName && group.sourceName !== 'Это устройство'" class="source">{{
          group.sourceName
        }}</span>
        <span v-if="groupBadge(group)" class="group-alert">{{ groupBadge(group) }}</span>
      </header>
      <AgentInboxRow
        v-for="item in shown(group)"
        :key="item.key"
        :item="item"
        :busy="busy === item.key"
        :unread="isUnread(item)"
        :acknowledgeable="canAcknowledge(item)"
        @open="commands.run('ide.inbox.work.open', { key: item.key })"
        @stop="commands.run('ide.inbox.work.stop', { key: item.key })"
        @read="commands.run('ide.inbox.work.read', { key: item.key })"
        @answered="refresh"
      />
      <details v-if="completed(group).length" class="done">
        <summary>Прочитанные за сутки · {{ completed(group).length }}</summary>
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
.done-alive {
  color: var(--info);
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
