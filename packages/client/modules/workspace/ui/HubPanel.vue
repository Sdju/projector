<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiSectionRefresh from "../../../common/ui/UiSectionRefresh.vue";
import UiStatusDot from "../../../common/ui/UiStatusDot.vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { deviceBase } from "../../../common/utilities/device-url.ts";
import { requestNotifications } from "../../agent-core/index.ts";
import { useAgentInbox } from "../../agent/index.ts";
import { hubNotifyEnabled, setHubNotifyEnabled } from "../../hub/index.ts";
import type { HubDevice } from "@ai-projector/core/modules/hub/index.ts";
import {
  hubActivityText,
  hubCountsText,
  hubDeviceCounts,
  hubDeviceItems,
  hubItemState,
  sortHubDevices,
} from "../lib/hub-panel.ts";

const router = useRouter();
const { items, hub, error, loading, refresh, href, markRead, isAttention, isUnread } =
  useAgentInbox();
const current = computed(() => deviceBase().split("/")[2] ?? "");
const self = computed(() => current.value || hub.value.deviceId || "");
const isHubPage = computed(() => !!current.value && !hub.value.local);
const hubUrl = computed(() => hub.value.url ?? "");
const userRefreshing = ref(false);
const permission = ref(
  typeof Notification === "undefined" ? "unsupported" : Notification.permission,
);
const commands = useCommandScope(`hub-panel:${deviceBase() || "local"}`, () => ({
  surface: "hub-panel",
  devices: hub.value.devices.length,
  online: hub.value.online ?? true,
}));

const devices = computed(() => sortHubDevices(hub.value.devices, self.value));
const online = computed(() => devices.value.filter((device) => device.online).length);
const setupNeeded = computed(() => !current.value && hub.value.enabled !== true);
const summary = computed(() => {
  if (isHubPage.value) {
    const noun = online.value === 1 ? "устройство" : online.value < 5 ? "устройства" : "устройств";
    return `${online.value} ${noun} в сети`;
  }
  if (!hub.value.enabled) return "не подключён";
  if (!hub.value.online) return hub.value.error || "ожидает подключения";
  return `подключён · ${online.value} в сети`;
});
const updated = computed(() =>
  loading.value
    ? "читаю устройства…"
    : hub.value.devices.length
      ? ""
      : setupNeeded.value
        ? "Настройки → Hub"
        : "Список устройств пуст",
);

const isSelf = (device: HubDevice) => device.id === self.value;
const deviceItems = (device: HubDevice) =>
  hubDeviceItems(items.value, device, self.value, !!current.value);
const activeItems = (device: HubDevice) =>
  deviceItems(device)
    .filter((item) => item.category === "working" || isAttention(item) || isUnread(item))
    .slice(0, 3);
const itemState = (item: (typeof items.value)[number]) => hubItemState(item);
/** Work is nested under a machine: only live or failing rows get a bright dot. */
const itemTone = (item: (typeof items.value)[number]) =>
  item.status === "error"
    ? "danger"
    : isAttention(item)
      ? "warning"
      : item.category === "working"
        ? "success"
        : "faint";
/** The muted tail of a machine line: activity and counts, never its own presence. */
const metaText = (device: HubDevice) =>
  [
    hubActivityText(hub.value.activity[device.id]),
    hubCountsText(hubDeviceCounts(deviceItems(device))),
  ]
    .filter(Boolean)
    .join(" · ");

async function reload(): Promise<void> {
  if (userRefreshing.value) return;
  userRefreshing.value = true;
  try {
    await refresh();
  } finally {
    userRefreshing.value = false;
  }
}
defineExpose({
  refresh: reload,
  refreshing: computed(() => loading.value || userRefreshing.value),
});

function deviceFrom(value: unknown): HubDevice {
  const deviceId = commandArgs(value).deviceId;
  const device = hub.value.devices.find((item) => item.id === deviceId);
  if (!device) throw new Error("Устройство Hub не найдено");
  return device;
}
function deviceHref(device: HubDevice): string | undefined {
  if (isSelf(device) || !device.online) return undefined;
  if (hub.value.local && current.value && device.id === hub.value.deviceId) return "/";
  const path = `/devices/${device.id}/`;
  if (current.value || hub.value.relay) return path;
  return hubUrl.value ? new URL(path, hubUrl.value).href : undefined;
}

function followDevice(event: MouseEvent, device: HubDevice): void {
  if (!deviceHref(device) || modifiedClick(event)) return;
  event.preventDefault();
  void commands.run("ide.hub.device.open", { deviceId: device.id });
}

function openHub(): void {
  if (isHubPage.value) {
    location.assign("/");
    return;
  }
  if (!hubUrl.value) throw new Error("Hub не подключён");
  window.open(hubUrl.value, "_blank", "noopener,noreferrer");
}
async function allowNotifications(): Promise<void> {
  await requestNotifications();
  permission.value = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
function modifiedClick(event: MouseEvent): boolean {
  return event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
}

function followItem(event: MouseEvent, item: (typeof items.value)[number]): void {
  if (!href(item) || modifiedClick(event)) return;
  event.preventDefault();
  void commands.run("ide.hub.item.open", { key: item.key });
}

commands.scope.registerCommand({
  id: "ide.hub.item.open",
  title: "Открыть работу Hub",
  description: "Открывает беседу или задание из панели Hub по ключу работы.",
  arguments: { key: "string: ключ работы" },
  run: (value) => {
    const item = items.value.find((entry) => entry.key === commandArgs(value).key);
    const link = item && href(item);
    if (!item || !link) throw new Error("Работа Hub недоступна");
    markRead(item);
    if (item.sourceId === current.value) return router.push(link.slice(deviceBase().length));
    location.assign(link);
  },
});
commands.scope.registerCommand({
  id: "ide.hub.devices.refresh",
  title: "Обновить устройства Hub",
  description:
    "Перечитывает устройства активного Hub и их работы. На локальной странице список приходит от подключённого туннеля.",
  run: reload,
});
commands.scope.registerCommand({
  id: "ide.hub.device.open",
  title: "Открыть устройство Hub",
  description: "Открывает список проектов выбранного устройства.",
  arguments: { deviceId: "string: id подключённого устройства" },
  enabled: () => devices.value.some((device) => device.online && !isSelf(device)),
  run: (value) => {
    const device = deviceFrom(value);
    if (isSelf(device)) throw new Error("Это устройство уже открыто");
    const link = deviceHref(device);
    if (!link) throw new Error("Устройство недоступно");
    if (link.startsWith("/")) location.assign(link);
    else window.open(link, "_blank", "noopener,noreferrer");
  },
});
commands.scope.registerCommand({
  id: "ide.hub.device.notify",
  title: "Уведомления устройства Hub",
  description:
    "Включает или выключает браузерные уведомления о работах другой машины. Собственное устройство не отключается.",
  arguments: {
    deviceId: "string: id подключённого устройства",
    enabled: "boolean: показывать уведомления с этого устройства",
  },
  run: (value) => {
    const args = commandArgs(value);
    const device = deviceFrom(value);
    if (isSelf(device)) throw new Error("Уведомления собственного устройства не отключаются");
    if (typeof args.enabled !== "boolean") throw new Error("enabled должен быть boolean");
    setHubNotifyEnabled(device.id, args.enabled);
  },
});
commands.scope.registerCommand({
  id: "ide.hub.notifications.allow",
  title: "Включить уведомления Hub",
  description:
    "Просит браузер показывать уведомления о работах других устройств, пока страница Projector скрыта.",
  enabled: () => permission.value === "default",
  run: allowNotifications,
});
commands.scope.registerCommand({
  id: "ide.hub.open",
  title: "Открыть Hub",
  description:
    "Открывает интерфейс Hub в новой вкладке. На странице Hub возвращает к списку устройств.",
  enabled: () => isHubPage.value || !!hubUrl.value,
  run: openHub,
});
</script>

<template>
  <div
    class="hub-panel"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <header class="head">
      <UiInline justify="between" align="center">
        <h3 class="title">Hub</h3>
        <UiSectionRefresh />
      </UiInline>
      <p class="status">
        <UiStatusDot
          :tone="hub.online === false || setupNeeded ? 'muted' : online ? 'success' : 'warning'"
        />
        <span>{{ summary }}</span>
      </p>
      <p v-if="updated" class="updated">{{ updated }}</p>
    </header>

    <UiMessage v-if="error" tone="danger" size="xs" role="alert" class="message">
      {{ error }}
    </UiMessage>

    <UiHint v-if="setupNeeded" class="setup">
      Hub не подключён. Укажите адрес, id устройства и токен в
      <RouterLink to="/settings">настройках</RouterLink>, чтобы видеть другие машины.
    </UiHint>

    <div v-if="devices.length" class="devices" aria-label="Устройства Hub">
      <article
        v-for="device in devices"
        :key="device.id"
        class="device"
        :class="{ offline: !device.online, self: isSelf(device) }"
      >
        <component
          :is="deviceHref(device) ? 'a' : 'div'"
          class="main"
          :href="deviceHref(device)"
          :title="
            isSelf(device)
              ? 'Это устройство уже открыто'
              : device.online
                ? `Открыть ${device.name}`
                : 'Устройство не в сети'
          "
          data-command="ide.hub.device.open"
          @click="followDevice($event, device)"
        >
          <span class="device-icon" aria-hidden="true"><ProjectorIcon name="monitor" /></span>
          <span class="device-text">
            <span class="device-line">
              <strong class="device-name">{{ device.name }}</strong>
              <span v-if="device.name !== device.id" class="device-id">{{ device.id }}</span>
              <span v-if="isSelf(device)" class="self-badge">это устройство</span>
            </span>
            <span class="meta">
              <UiStatusDot :size="6" :tone="device.online ? 'success' : 'muted'" />
              <span>{{ device.online ? "в сети" : "не в сети" }}</span>
              <template v-if="metaText(device)">
                <span aria-hidden="true">·</span>
                <span class="meta-tail">{{ metaText(device) }}</span>
              </template>
            </span>
          </span>
        </component>
        <div v-if="(current || hub.relay) && !isSelf(device)" class="actions">
          <UiButton
            shape="icon"
            size="sm"
            :title="
              hubNotifyEnabled(device.id)
                ? `Выключить уведомления с ${device.name}`
                : `Включить уведомления с ${device.name}`
            "
            :aria-label="
              hubNotifyEnabled(device.id)
                ? `Выключить уведомления с ${device.name}`
                : `Включить уведомления с ${device.name}`
            "
            data-command="ide.hub.device.notify"
            @click="
              commands.run('ide.hub.device.notify', {
                deviceId: device.id,
                enabled: !hubNotifyEnabled(device.id),
              })
            "
          >
            <ProjectorIcon name="bell" v-if="hubNotifyEnabled(device.id)" aria-hidden="true" />
            <ProjectorIcon name="bell-off" v-else aria-hidden="true" />
          </UiButton>
        </div>

        <ul v-if="activeItems(device).length" class="work" :aria-label="`Работы ${device.name}`">
          <li v-for="item in activeItems(device)" :key="item.key">
            <component
              :is="href(item) ? 'a' : 'div'"
              class="work-item"
              :href="href(item)"
              data-command="ide.hub.item.open"
              :title="`${item.projectName} · ${item.topic}`"
              @click="followItem($event, item)"
            >
              <span class="work-head">
                <UiStatusDot :size="6" :tone="itemTone(item)" />
                <span class="work-topic">{{ item.topic }}</span>
              </span>
              <span class="work-meta">{{ item.projectName }} · {{ itemState(item) }}</span>
            </component>
          </li>
        </ul>
        <p
          v-else-if="!isSelf(device) && device.online && !current && !hub.relay"
          class="remote-hint"
        >
          Работы и переход в проект — в Hub.
        </p>
      </article>
    </div>

    <UiHint v-else-if="!loading && !setupNeeded" class="empty">
      Других устройств нет. Подключите машину к Hub или дождитесь её появления.
    </UiHint>

    <footer class="foot">
      <UiHint v-if="permission === 'default'" class="permission">
        Уведомления выключены.
        <UiButton size="sm" data-command="ide.hub.notifications.allow" @click="allowNotifications"
          >Включить</UiButton
        >
      </UiHint>
      <UiHint v-else-if="permission === 'denied'" class="permission">
        Уведомления запрещены в настройках браузера.
      </UiHint>
      <button
        v-if="isHubPage || hubUrl"
        type="button"
        class="link"
        data-command="ide.hub.open"
        @click="openHub"
      >
        <ProjectorIcon name="external-link" aria-hidden="true" />
        {{ isHubPage ? "К списку устройств" : "Открыть Hub" }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.hub-panel {
  display: grid;
  align-content: start;
  min-width: 0;
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
.status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.updated {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.message,
.setup,
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
.devices {
  display: grid;
  min-width: 0;
  margin-top: var(--sp-2);
}
.device {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  min-width: 0;
  border-top: 1px solid var(--line);
}
.main,
.work-item {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  width: 100%;
  min-width: 0;
  border: 0;
  background: none;
  color: var(--text-2);
  font: inherit;
  text-align: left;
  text-decoration: none;
}
.main {
  flex-direction: row;
  align-items: flex-start;
  gap: var(--sp-2);
  padding: var(--sp-2) var(--sp-3);
}
a.main:hover,
a.work-item:hover {
  background: var(--hover);
}
.device-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--sp-5);
  height: var(--sp-5);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-3);
  color: var(--muted);
}
.device.offline .device-icon {
  background: none;
  color: var(--faint);
}
.device.offline .device-name {
  color: var(--text-2);
}
.device.offline .meta {
  color: var(--faint);
}
.device-text {
  display: grid;
  flex: 1;
  gap: 3px;
  min-width: 0;
}
.device-line,
.work-head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.device-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.device-id {
  min-width: 0;
  overflow: hidden;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.self-badge {
  flex: none;
  padding: 0 var(--sp-1);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.meta {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  min-width: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
  white-space: nowrap;
}
.meta-tail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.actions {
  display: flex;
  gap: 2px;
  padding: var(--sp-1) var(--sp-2) 0 0;
}
.work,
.remote-hint {
  grid-column: 1 / -1;
}
.work {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1px;
  margin: 0 0 var(--sp-1) calc(var(--sp-3) + 11px);
  padding: var(--sp-1) 0 var(--sp-1) var(--sp-2);
  border-left: 1px solid var(--line);
  list-style: none;
}
.work-item {
  padding: var(--sp-1) var(--sp-2) var(--sp-1) 0;
  border-radius: 0 var(--r-sm) var(--r-sm) 0;
}
.work-topic {
  min-width: 0;
  overflow: hidden;
  color: var(--text-2);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.work-meta {
  padding-left: calc(6px + var(--sp-2));
  overflow: hidden;
  color: var(--faint);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.remote-hint {
  margin: 0;
  padding: 0 var(--sp-3) var(--sp-2) calc(var(--sp-3) + var(--sp-2) + var(--sp-5));
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.45;
}
.foot {
  display: grid;
  min-width: 0;
}
.link {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-3);
  border: 0;
  border-top: 1px solid var(--line);
  background: none;
  color: var(--muted);
  font: inherit;
  font-size: var(--fs-2xs);
  text-align: left;
  cursor: pointer;
}
.link:hover {
  background: var(--hover);
  color: var(--text);
}
.hub-panel :deep(svg) {
  width: 13px;
  height: 13px;
}
.hub-panel .device-icon svg {
  width: 15px;
  height: 15px;
}
</style>
