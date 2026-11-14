<script setup lang="ts">
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
import IconBell from "~icons/lucide/bell";
import IconBellOff from "~icons/lucide/bell-off";
import IconExternalLink from "~icons/lucide/external-link";
import IconServer from "~icons/lucide/server";

const router = useRouter();
const { items, hub, error, loading, refresh, href, markRead, isAttention, isUnread } =
  useAgentInbox();
const current = computed(() => deviceBase().split("/")[2] ?? "");
const self = computed(() => current.value || hub.value.deviceId || "");
const isHubPage = computed(() => !!current.value);
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
const setupNeeded = computed(() => !isHubPage.value && hub.value.enabled !== true);
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
  hubDeviceItems(items.value, device, self.value, isHubPage.value);
const activeItems = (device: HubDevice) =>
  deviceItems(device)
    .filter((item) => item.category === "working" || isAttention(item) || isUnread(item))
    .slice(0, 3);
const stateText = (device: HubDevice) => (device.online ? "в сети" : "не в сети");
const activityText = (device: HubDevice) => hubActivityText(hub.value.activity[device.id]);
const itemState = (item: (typeof items.value)[number]) => hubItemState(item);
const countsText = (device: HubDevice) => hubCountsText(hubDeviceCounts(deviceItems(device)));

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
/** A Hub page switches the page context; a local page can only offer the Hub origin. */
function openDevice(device: HubDevice): void {
  if (!device.online) throw new Error("Устройство не в сети");
  if (isHubPage.value) {
    location.assign(`/devices/${device.id}/`);
    return;
  }
  if (!hubUrl.value) throw new Error("Hub не подключён");
  window.open(
    new URL(`/devices/${device.id}/`, hubUrl.value).href,
    "_blank",
    "noopener,noreferrer",
  );
}
function openHub(): void {
  if (isHubPage.value) {
    location.assign("/");
    return;
  }
  if (!hubUrl.value) throw new Error("Hub не подключён");
  window.open(hubUrl.value, "_blank", "noopener,noreferrer");
}
function toggleNotifications(device: HubDevice): void {
  setHubNotifyEnabled(device.id, !hubNotifyEnabled(device.id));
}
async function allowNotifications(): Promise<void> {
  await requestNotifications();
  permission.value = typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}
function openItem(item: (typeof items.value)[number]): void {
  const link = href(item);
  if (!link) return;
  markRead(item);
  const same = !item.sourceId || item.sourceId === current.value;
  if (same) {
    const base = deviceBase();
    return void router.push(base && link.startsWith(base) ? link.slice(base.length) || "/" : link);
  }
  location.assign(link);
}

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
  description:
    "Открывает проектное пространство другой машины. На странице Hub контекст меняется в этой вкладке, локальная страница открывает Hub отдельно.",
  arguments: { deviceId: "string: id подключённого устройства" },
  enabled: () => devices.value.some((device) => device.online && !isSelf(device)),
  run: (value) => {
    const device = deviceFrom(value);
    if (isSelf(device)) throw new Error("Это устройство уже открыто");
    openDevice(device);
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
        <strong class="title">Hub</strong>
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
        <header class="device-head">
          <UiStatusDot :tone="device.online ? 'success' : 'muted'" />
          <div class="device-name">
            <strong>{{ device.name }}</strong>
            <span v-if="device.name !== device.id" class="device-id">{{ device.id }}</span>
          </div>
          <span v-if="isSelf(device)" class="badge">это устройство</span>
        </header>
        <p class="meta">
          <span>{{ stateText(device) }}</span>
          <span v-if="activityText(device)"> · {{ activityText(device) }}</span>
        </p>
        <p v-if="countsText(device)" class="counts">{{ countsText(device) }}</p>

        <ul v-if="activeItems(device).length" class="work">
          <li v-for="item in activeItems(device)" :key="item.key">
            <button
              type="button"
              class="work-item"
              :title="`${item.projectName} · ${item.topic}`"
              @click="openItem(item)"
            >
              <span class="work-head">
                <UiStatusDot
                  :tone="
                    isAttention(item) ? 'warning' : item.status === 'error' ? 'danger' : 'success'
                  "
                />
                <span class="work-project">{{ item.projectName }}</span>
                <span class="work-state">{{ itemState(item) }}</span>
              </span>
              <span class="work-topic">{{ item.topic }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="!isSelf(device) && device.online && !isHubPage" class="remote-hint">
          Работы и переход в проект — в Hub.
        </p>

        <UiInline v-if="!isSelf(device)" class="actions" :gap="1" wrap>
          <UiButton
            size="sm"
            :disabled="!device.online"
            data-command="ide.hub.device.open"
            @click="openDevice(device)"
          >
            <IconServer aria-hidden="true" />Открыть
          </UiButton>
          <UiButton
            v-if="isHubPage"
            shape="icon"
            size="sm"
            appearance="quiet"
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
            @click="toggleNotifications(device)"
          >
            <IconBell v-if="hubNotifyEnabled(device.id)" aria-hidden="true" />
            <IconBellOff v-else aria-hidden="true" />
          </UiButton>
        </UiInline>
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
      <UiButton
        v-if="isHubPage || hubUrl"
        size="sm"
        appearance="quiet"
        data-command="ide.hub.open"
        @click="openHub"
      >
        <IconExternalLink aria-hidden="true" />{{
          isHubPage ? "К списку устройств" : "Открыть Hub"
        }}
      </UiButton>
    </footer>
  </div>
</template>

<style scoped>
.hub-panel {
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
.message {
  margin: 0;
}
.devices {
  display: grid;
  gap: var(--sp-2);
}
.device {
  display: grid;
  gap: var(--sp-1);
  min-width: 0;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-2);
}
.device.self {
  border-color: var(--line-2, var(--line));
  background: var(--bg-3);
}
.device.offline {
  opacity: 0.62;
}
.device-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.device-name {
  display: flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.device-name strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
}
.device-id {
  overflow: hidden;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.badge {
  flex-shrink: 0;
  margin-left: auto;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--muted);
  font-size: 10px;
  line-height: 16px;
}
.meta,
.counts,
.remote-hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.counts {
  color: var(--text-2);
}
.work {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.work-item {
  display: grid;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 4px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--text-2);
  font: inherit;
  font-size: var(--fs-2xs);
  text-align: left;
  cursor: pointer;
}
.work-item:hover {
  background: var(--hover);
  color: var(--text);
}
.work-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.work-project,
.work-topic {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.work-project {
  color: var(--muted);
}
.work-state {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--muted);
}
.actions :deep(svg),
.foot :deep(svg) {
  width: 13px;
  height: 13px;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-2);
}
.permission {
  flex: 1;
}
</style>
