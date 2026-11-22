<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
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
import { cancelAgentRun, requestNotifications, stopJob } from "../../../../agent-core/index.ts";
import { deviceRoute } from "../../../../../common/utilities/device-url.ts";
import { appUpdateInboxPending, AppUpdateNotice } from "../../../../app-update/index.ts";
import { useAgentInbox, type InboxGroup, type InboxItem } from "../model/inbox.ts";
import AgentInboxNotice from "./AgentInboxNotice.vue";
import AgentInboxRow from "./AgentInboxRow.vue";

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
  noticeHref,
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

const waiting = computed(() => Math.max(0, attention.value - noticeUnread.value));

/** Non-empty counters of the header; zero values would only add noise. */
const summary = computed(() =>
  [
    { key: "attention", text: `${waiting.value} ждут вас`, count: waiting.value, alert: true },
    {
      key: "update",
      text: "доступно обновление",
      count: Number(appUpdateInboxPending()),
      alert: true,
    },
    { key: "working", text: `${working.value} работают`, count: working.value },
    {
      key: "trust",
      text: `${noticeUnread.value} по доверию`,
      count: noticeUnread.value,
      alert: true,
    },
    unread.value
      ? { key: "unread", text: `${unread.value} завершили`, count: unread.value }
      : { key: "finished", text: `${finished.value} завершились`, count: finished.value },
  ].filter((part) => part.count > 0),
);
const footnote = computed(() => {
  const parts: string[] = [];
  if (updated.value) parts.push(`обновлено в ${updated.value}`);
  if (hubDevices.value) {
    const total = hubDevices.value + 1;
    parts.push(`Hub: ${total} ${total === 1 ? "устройство" : "устройства"}`);
  }
  return parts.join(" · ");
});

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
function followLink(event: MouseEvent, command: string, key: string): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    !(event.currentTarget instanceof HTMLAnchorElement)
  )
    return;
  event.preventDefault();
  void commands.run(command, { key });
}

function navigate(link: string): void {
  const route = deviceRoute(link);
  emit("navigate");
  if (route) void router.push(route);
  else location.assign(link);
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
    navigate(noticeHref(notice));
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

function open(item: InboxItem): void {
  const link = href(item);
  if (!link) return;
  markRead(item);
  navigate(link);
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
        <h3 class="title">Работы</h3>
        <UiInline :gap="1" align="center">
          <UiButton
            v-if="hasAcknowledgeable"
            shape="icon"
            size="sm"
            title="Прочитать всё"
            aria-label="Прочитать всё"
            data-command="ide.inbox.read.all"
            @click="commands.run('ide.inbox.read.all')"
          >
            <ProjectorIcon name="check-check" aria-hidden="true" />
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
            <ProjectorIcon name="rotate-cw" aria-hidden="true" />
          </UiButton>
        </UiInline>
      </UiInline>
      <p v-if="summary.length" class="counts">
        <template v-for="(part, index) in summary" :key="part.key">
          <span v-if="index">·</span>
          <span :class="{ alert: part.alert }">{{ part.text }}</span>
        </template>
      </p>
      <p v-if="footnote" class="footnote">{{ footnote }}</p>
    </header>

    <UiLoader
      v-if="!hostRefresh && loading && !items.length && !notices.length && !appUpdateInboxPending()"
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

    <p
      v-if="!loading && !items.length && !notices.length && !appUpdateInboxPending()"
      class="empty"
    >
      Ничего не работает и не ждёт ответа. Задания и чаты появятся здесь для всех проектов и
      устройств.
    </p>

    <AppUpdateNotice />
    <section v-if="notices.length" class="group">
      <header class="group-head">
        <span class="project">Доверие</span>
        <span v-if="noticeUnread" class="group-alert">{{ noticeUnread }}</span>
      </header>
      <AgentInboxNotice
        v-for="notice in notices"
        :key="notice.id"
        :notice="notice"
        :href="noticeHref(notice)"
        :unread="!isNoticeRead(notice)"
        :busy="busyNotice === notice.id"
        @open="followLink($event, 'ide.inbox.notice.open', notice.id)"
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
        :href="href(item)"
        :busy="busy === item.key"
        :unread="isUnread(item)"
        :acknowledgeable="canAcknowledge(item)"
        @open="followLink($event, 'ide.inbox.work.open', item.key)"
        @stop="commands.run('ide.inbox.work.stop', { key: item.key })"
        @read="commands.run('ide.inbox.work.read', { key: item.key })"
        @answered="refresh"
      />
      <details v-if="completed(group).length" class="done">
        <summary>
          <ProjectorIcon name="chevron-right" class="chevron" aria-hidden="true" />
          Прочитанные за сутки
          <span class="count">{{ completed(group).length }}</span>
        </summary>
        <AgentInboxRow
          v-for="item in completed(group)"
          :key="item.key"
          :item="item"
          :href="href(item)"
          :busy="busy === item.key"
          @open="followLink($event, 'ide.inbox.work.open', item.key)"
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
  /* In a wide tab the list stays a readable column instead of stretching over the dock. */
  width: min(100%, 760px);
  min-width: 0;
  margin-inline: auto;
  padding: var(--sp-3) 0;
  color: var(--text);
  font-size: var(--fs-xs);
}
.head {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 0 var(--sp-3) var(--sp-2);
}
.title {
  margin: 0;
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
.counts .alert {
  color: var(--warn);
}
.footnote {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.message,
.permission {
  margin: var(--sp-2) var(--sp-3) 0;
}
.permission {
  font-size: var(--fs-2xs);
}
.empty {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--faint);
  line-height: 1.45;
}
.group {
  display: grid;
  min-width: 0;
  margin-top: var(--sp-2);
}
.group-head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  font-weight: 500;
}
.project {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 400;
}
.group-alert,
.count {
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
}
.done summary {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--fs-2xs);
  cursor: pointer;
  list-style: none;
}
.done summary::-webkit-details-marker {
  display: none;
}
.done summary:hover {
  color: var(--text);
}
.chevron {
  flex-shrink: 0;
  transition: transform var(--t-fast);
}
.done[open] .chevron {
  transform: rotate(90deg);
}
.inbox :deep(svg) {
  width: 13px;
  height: 13px;
}
</style>
