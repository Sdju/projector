<script setup lang="ts">
import { ref, shallowRef, onMounted, onBeforeUnmount, computed } from "vue";
import { isDeviceId } from "@projector-ai/core/modules/hub/index.ts";
import { deviceBase } from "../../common/utilities/device-url.ts";
import { useCommandScope, commandArgs } from "../../common/utilities/commands.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiField from "../../common/ui/UiField.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import UiInline from "../../common/ui/UiInline.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiStatusDot from "../../common/ui/UiStatusDot.vue";
import { hubRequest } from "./client.ts";
interface State {
  connections: { url: string; deviceId: string }[];
  enabled: boolean;
  online: boolean;
  url?: string;
  deviceId?: string;
  error?: string;
}
const state = shallowRef<State>();
const selected = ref("");
const url = ref("");
const deviceId = ref("");
const token = ref("");
const remote = !!deviceBase();
const { ready, busy, error, status, load, perform } = useSectionAction();
const commands = useCommandScope("hub-settings", () => ({
  surface: "hub-settings",
  online: state.value?.online ?? false,
}));
let timer: ReturnType<typeof setInterval> | undefined;
const abort = new AbortController();
const valid = computed(
  () =>
    !!url.value.trim() &&
    isDeviceId(deviceId.value) &&
    (!!token.value ||
      state.value?.connections.some((item) => item.url === url.value.replace(/\/$/, ""))),
);
async function refresh(initial = false) {
  const data = await hubRequest<State>("/api/hub", { signal: abort.signal });
  if (abort.signal.aborted) return;
  state.value = data;
  if (initial) {
    selectHub(data.url ?? data.connections[0]?.url ?? "");
  }
}
function selectHub(value: string) {
  selected.value = value;
  const saved = state.value?.connections.find((item) => item.url === value);
  url.value = saved?.url ?? "";
  deviceId.value = saved?.deviceId ?? "";
  token.value = "";
}
async function changeConnection(body: object) {
  await perform(
    async () => {
      state.value = await hubRequest<State>("/api/hub", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (selected.value && !state.value.connections.some((item) => item.url === selected.value))
        selectHub("");
    },
    { errorFallback: "Не удалось изменить подключение Hub" },
  );
}
async function save() {
  await perform(
    async () => {
      const data = await hubRequest<State>("/api/hub", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          url: url.value.trim(),
          deviceId: deviceId.value,
          token: token.value,
        }),
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      state.value = data;
      selectHub(new URL(url.value.trim()).origin);
      token.value = "";
    },
    { errorFallback: "Не удалось подключиться к Hub", success: "Подключение сохранено" },
  );
}
commands.scope.registerCommand({
  id: "ide.hub.connection.save",
  title: "Сохранить Hub",
  description:
    "Сохраняет адрес Hub, id устройства и токен. Для подключения выберите сохранённый Hub.",
  enabled: () => ready.value && !busy.value && !!valid.value,
  run: save,
});
commands.scope.registerCommand({
  id: "ide.hub.connection.select",
  title: "Выбрать сохранённый Hub",
  description: "Выбирает Hub для редактирования или очищает форму для нового подключения.",
  arguments: { url: "string: адрес сохранённого Hub или пустая строка" },
  run: (value) => {
    const { url } = commandArgs(value);
    if (
      typeof url !== "string" ||
      (url && !state.value?.connections.some((item) => item.url === url))
    )
      throw new Error("Hub не найден");
    selectHub(url);
  },
});
commands.scope.registerCommand({
  id: "ide.hub.connection.activate",
  title: "Подключить выбранный Hub",
  description:
    "Отключает предыдущий туннель и подключает выбранный Hub, сохраняя терминалы и задания.",
  enabled: () => !busy.value && !!selected.value && state.value?.url !== selected.value,
  run: () => changeConnection({ action: "activate", url: selected.value }),
});
commands.scope.registerCommand({
  id: "ide.hub.connection.delete",
  title: "Удалить сохранённый Hub",
  description: "Удаляет выбранное подключение и его токен; активный туннель отключается.",
  enabled: () => !busy.value && !!selected.value,
  run: () => changeConnection({ action: "delete", url: selected.value }),
});
commands.scope.registerCommand({
  id: "ide.hub.connection.disconnect",
  title: "Отключить Projector от Hub",
  description: "Останавливает туннель, сохраняя Hub и токен для следующего подключения.",
  enabled: () => !busy.value && !!state.value?.enabled,
  run: () => changeConnection({ enabled: false }),
});
commands.scope.registerCommand({
  id: "ide.hub.open",
  title: "Открыть Hub",
  description: "Открывает интерфейс настроенного Hub в новой вкладке браузера.",
  enabled: () => !!selected.value,
  run: () => {
    if (selected.value) window.open(selected.value, "_blank", "noopener,noreferrer");
  },
});
onMounted(async () => {
  if (remote) return;
  await load(() => refresh(true), "Не удалось загрузить подключение Hub");
  if (!abort.signal.aborted)
    timer = setInterval(() => {
      if (!busy.value) void refresh().catch(() => {});
    }, 3000);
});
onBeforeUnmount(() => {
  abort.abort();
  clearInterval(timer);
});
</script>
<template>
  <section
    class="settings"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
    @keydown="commands.keydown"
  >
    <UiHeading as="h2" size="sm">Подключения к Hub</UiHeading>
    <UiHint v-if="remote">Подключение управляется в локальном Projector на этой машине.</UiHint>
    <template v-else>
      <UiHint
        >Hub даёт доступ к этой машине через общий веб-интерфейс. Локальный сервер остаётся
        доступным по своему адресу.</UiHint
      >
      <UiField
        v-slot="{ control }"
        label="Сохранённые хабы"
        hint="Одновременно активно только одно подключение."
      >
        <UiControl
          v-bind="control"
          as="select"
          :model-value="selected"
          :disabled="!ready || busy"
          @update:model-value="commands.run('ide.hub.connection.select', { url: $event })"
        >
          <option value="">Новый Hub</option>
          <option v-for="hub in state?.connections" :key="hub.url" :value="hub.url">
            {{ hub.url }}{{ state?.url === hub.url ? " · активен" : "" }}
          </option>
        </UiControl>
      </UiField>
      <UiInline v-if="selected" wrap>
        <UiButton
          :disabled="busy || state?.url === selected"
          @click="commands.run('ide.hub.connection.activate')"
          >Подключить</UiButton
        >
        <UiButton :disabled="busy" @click="commands.run('ide.hub.open')">Открыть Hub</UiButton>
        <UiButton :disabled="busy" @click="commands.run('ide.hub.connection.delete')"
          >Удалить</UiButton
        >
      </UiInline>
      <UiHint v-if="state?.url">Активный Hub: {{ state.url }}</UiHint>
      <UiInline v-if="state" role="status"
        ><UiStatusDot :tone="state.online ? 'success' : state.enabled ? 'warning' : 'muted'" />{{
          state.online ? "Подключено" : state.enabled ? "Ожидание подключения" : "Не подключено"
        }}</UiInline
      >
      <UiMessage v-if="state?.error" tone="danger" role="status">{{ state.error }}</UiMessage>
      <form class="form" @submit.prevent="commands.run('ide.hub.connection.save')">
        <UiField
          v-slot="{ control }"
          label="Адрес Hub"
          hint="HTTPS-адрес; для localhost также разрешён HTTP."
          required
        >
          <UiControl
            v-bind="control"
            v-model="url"
            type="url"
            placeholder="https://hub.example.com"
            :disabled="busy"
          />
        </UiField>
        <UiField
          v-slot="{ control }"
          label="ID устройства"
          hint="Латинские строчные буквы, цифры и дефис. Стабильное имя этой машины."
          required
        >
          <UiControl
            v-bind="control"
            v-model="deviceId"
            pattern="[a-z0-9][a-z0-9\-]{0,62}"
            maxlength="63"
            placeholder="workstation"
            :disabled="busy"
          />
        </UiField>
        <UiField
          v-slot="{ control }"
          label="Токен подключения"
          :hint="
            selected
              ? 'Оставьте пустым, чтобы сохранить существующий токен для этого Hub.'
              : 'Токен устройства, настроенный на Hub; отличается от пароля входа.'
          "
        >
          <UiControl
            v-bind="control"
            v-model="token"
            type="password"
            autocomplete="new-password"
            :disabled="busy"
          />
        </UiField>
        <UiInline wrap>
          <UiButton type="submit" appearance="solid" :busy="busy" :disabled="!ready || !valid">{{
            selected ? "Сохранить" : "Добавить Hub"
          }}</UiButton>
          <UiButton
            v-if="state?.enabled"
            :disabled="busy"
            @click="commands.run('ide.hub.connection.disconnect')"
            >Отключить</UiButton
          >
        </UiInline>
      </form>
      <UiMessage v-if="error || status" :tone="error ? 'danger' : undefined" role="status">{{
        error || status
      }}</UiMessage>
    </template>
  </section>
</template>
<style scoped>
.settings,
.form {
  display: grid;
  gap: var(--sp-4);
}
.form {
  max-width: 480px;
}
</style>
