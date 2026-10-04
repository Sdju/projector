<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { DockerSnapshot } from "../../../../core/modules/docker/index.ts";
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
onMounted(
  () =>
    void load().catch((err) => {
      error.value = err.message;
    }),
);
</script>
<template>
  <section class="docker-settings" @pointerdown="commands.scope.activate()">
    <header>
      <h3>Подключение</h3>
      <span>{{ snapshot?.connected ? `подключён · ${snapshot.version}` : "не подключён" }}</span>
    </header>
    <form @submit.prevent="commands.run('ide.docker.settings.save')">
      <label
        ><input v-model="enabled" type="checkbox" :disabled="busy" /> включить интеграцию</label
      >
      <label
        >Окружение
        <select v-model="context" :disabled="busy">
          <option
            v-for="item in snapshot?.contexts"
            :key="item.name"
            :value="item.name"
            :disabled="!item.local"
          >
            {{ item.name }} · {{ item.endpoint }}
          </option>
        </select></label
      >
      <div class="actions">
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
      </div>
    </form>
    <p v-if="snapshot?.composeVersion" class="muted">Compose {{ snapshot.composeVersion }}</p>
    <p v-if="error || snapshot?.error" class="error" role="alert">{{ error || snapshot?.error }}</p>
  </section>
</template>
<style scoped>
.docker-settings {
  margin: 0;
  font-size: var(--fs-sm);
}
header,
.actions {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
header {
  justify-content: space-between;
}
h3 {
  font-size: var(--fs-sm);
  font-weight: 500;
  margin: 0 0 var(--sp-3);
}
header span,
.muted {
  color: var(--muted);
  font-size: var(--fs-xs);
}
form {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
select {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text);
  padding: var(--sp-2);
  min-width: 0;
  max-width: 100%;
  flex: 1;
}
.error {
  color: var(--err);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
}
</style>
