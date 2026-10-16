<script setup lang="ts">
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiInline from "../../../common/ui/UiInline.vue";

import { onMounted, ref } from "vue";
import type { DockerSnapshot } from "../../../../core/modules/docker/index.ts";
import DockerDaemonNotice from "./DockerDaemonNotice.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { useCommandScope, commandArgs } from "../../../common/utilities/commands.ts";
import { dockerRequest } from "../client.ts";
const snapshot = ref<DockerSnapshot>();
const enabled = ref(false),
  context = ref("default"),
  busy = ref(false),
  error = ref("");
const commands = useCommandScope("docker:settings", () => ({
  surface: "dockerSettings",
  busy: busy.value,
}));
async function load() {
  const result = await dockerRequest<DockerSnapshot>();
  snapshot.value = result;
  enabled.value = result.enabled;
  context.value = result.context;
  return result;
}
commands.scope.registerCommand({
  id: "ide.docker.settings.status",
  title: "Проверить подключение Docker",
  description: "Возвращает настройки, локальные contexts, доступность daemon и Compose.",
  run: load,
});
commands.scope.registerCommand({
  id: "ide.docker.settings.save",
  title: "Сохранить интеграцию Docker",
  description: "Сохраняет enabled и context на диске; Docker и контейнеры не запускает.",
  arguments: { enabled: "boolean", context: "Локальный Docker context" },
  enabled: () => !busy.value,
  run: async (value) => {
    const args = commandArgs(value);
    busy.value = true;
    error.value = "";
    try {
      await dockerRequest("/settings", undefined, "PUT", {
        enabled: args.enabled ?? enabled.value,
        context: args.context ?? context.value,
      });
      return await load();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка Docker";
      throw err;
    } finally {
      busy.value = false;
    }
  },
});
commands.scope.registerCommand({
  id: "ide.docker.settings.daemonStart",
  title: "Запустить Docker daemon",
  description:
    "Если daemon не запущен, поднимает его способом, принятым в этой ОС, и ждёт ответа до 90 секунд. Может запросить пароль администратора.",
  enabled: () => !busy.value && !!snapshot.value?.enabled && !!snapshot.value.daemon?.start.auto,
  run: async () => {
    busy.value = true;
    error.value = "";
    try {
      await dockerRequest("/daemon/start", undefined, "POST", { context: context.value });
      return await load();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка Docker";
      throw err;
    } finally {
      busy.value = false;
    }
  },
});
onMounted(
  () =>
    void load().catch((err) => {
      error.value = err.message;
    }),
);
</script>
<template>
  <section class="docker-settings" @pointerdown="commands.scope.activate()">
    <UiInline as="header" :gap="3" justify="between" wrap>
      <UiHeading as="h3" size="sm">Подключение</UiHeading>
      <span>{{ snapshot?.connected ? `подключён · ${snapshot.version}` : "не подключён" }}</span>
    </UiInline>
    <UiStack as="form" flow="flex" @submit.prevent="commands.run('ide.docker.settings.save')">
      <UiInline as="label" justify="normal"
        ><UiControl v-model="enabled" type="checkbox" :disabled="busy" /> включить
        интеграцию</UiInline
      >
      <UiInline as="label" justify="normal"
        >Окружение
        <UiControl as="select" appearance="filled" v-model="context" :disabled="busy">
          <option
            v-for="item in snapshot?.contexts"
            :key="item.name"
            :value="item.name"
            :disabled="!item.local"
          >
            {{ item.name }} · {{ item.endpoint }}
          </option>
        </UiControl></UiInline
      >
      <UiInline class="actions" :gap="3" wrap>
        <UiButton
          type="submit"
          :disabled="
            busy ||
            (enabled && !snapshot?.contexts.some((item) => item.name === context && item.local))
          "
          >Сохранить</UiButton
        ><UiButton :disabled="busy" @click="commands.run('ide.docker.settings.status')"
          >Проверить подключение</UiButton
        >
      </UiInline>
    </UiStack>
    <p v-if="snapshot?.composeVersion" class="muted">Compose {{ snapshot.composeVersion }}</p>
    <DockerDaemonNotice
      v-if="error || snapshot?.error"
      :message="error || snapshot?.error || ''"
      :daemon="snapshot?.daemon"
      :starting="busy"
      @start="commands.run('ide.docker.settings.daemonStart')"
    />
  </section>
</template>
<style scoped>
.docker-settings {
  margin: 0;
  font-size: var(--fs-sm);
}
header span,
.muted {
  color: var(--muted);
  font-size: var(--fs-xs);
}
form {
  min-width: auto;
}
select {
  max-width: 100%;
  flex: 1;
}
</style>
