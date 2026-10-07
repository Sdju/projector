<script setup lang="ts">
import { ref } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { fetchIntegrations, integrationRequest } from "../integration-api/index.ts";
const props = defineProps<{ repository: string }>();
const emit = defineEmits<{ connected: [] }>();
const token = ref("");
const busy = ref(false);
const error = ref("");
const commands = useCommandScope(`github-connection:${props.repository}`, () => ({
  surface: "github-integration",
  repository: props.repository,
}));
commands.scope.registerCommand({
  id: "ide.github.integration.connect",
  title: "Подключить GitHub",
  description:
    "Подключает GitHub с токеном, введённым в форме интеграции, и открывает репозиторий.",
  enabled: () => !busy.value && !!token.value.trim(),
  async run() {
    busy.value = true;
    error.value = "";
    try {
      const data = await fetchIntegrations();
      const github = data.integrations.find((integration) => integration.id === "github");
      if (!github?.enabled)
        await integrationRequest("/github", "PUT", { ...github?.settings, enabled: true });
      await integrationRequest("/github/auth", "POST", { token: token.value.trim() });
      token.value = "";
      emit("connected");
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Не удалось подключить GitHub";
    } finally {
      busy.value = false;
    }
  },
});
</script>

<template>
  <section class="connection">
    <h2>Подключить GitHub</h2>
    <p>Установите токен, чтобы открыть {{ repository }}.</p>
    <form @submit.prevent="commands.run('ide.github.integration.connect')">
      <label for="github-connection-token">Токен GitHub</label>
      <input
        id="github-connection-token"
        v-model="token"
        type="password"
        autocomplete="off"
        placeholder="github_pat_…"
        :disabled="busy"
        required
      />
      <UiButton
        type="submit"
        data-command="ide.github.integration.connect"
        :disabled="busy || !token.trim()"
        >{{ busy ? "Подключаю…" : "Подключить GitHub" }}</UiButton
      >
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer"
      >Создать токен в GitHub ↗</a
    >
  </section>
</template>

<style scoped>
.connection {
  max-width: 460px;
  padding: var(--sp-5);
}
h2 {
  font-size: var(--fs-md);
  font-weight: 500;
  margin: 0 0 var(--sp-3);
}
p,
a,
label {
  font-size: var(--fs-sm);
}
p,
a {
  color: var(--muted);
}
form {
  display: grid;
  gap: var(--sp-3);
  margin: var(--sp-4) 0;
}
input {
  min-width: 0;
  width: 100%;
}
form :deep(button) {
  justify-self: start;
}
a {
  text-decoration: underline;
}
.error {
  color: var(--err);
}
</style>
