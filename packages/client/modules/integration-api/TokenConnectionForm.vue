<script setup lang="ts">
import UiButton from "../../common/ui/UiButton.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiHeading from "../../common/ui/UiHeading.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiStack from "../../common/ui/UiStack.vue";
import { ref, useId } from "vue";
import { useCommandScope } from "../../common/utilities/commands.ts";
import { readoutLines, useTabReadout } from "../../common/utilities/tab-readout.ts";
import { useIntegrationOperation } from "./operation.ts";

/** Token form shared by GitHub and GitLab: command, readout and async state are the same. */
const props = defineProps<{
  host: string;
  subjectLabel: string;
  subject: string;
  projectId: string;
  scopeKey: string;
  surface: string;
  placeholder: string;
  tokenUrl: string;
  commandId: string;
  commandDescription: string;
  readoutNote: string;
  intro?: string;
  connect: (token: string) => Promise<void>;
}>();
const emit = defineEmits<{ connected: [] }>();
const token = ref("");
const tokenId = useId();
const { busy, error, action } = useIntegrationOperation();
const commands = useCommandScope(props.scopeKey, () => ({
  surface: props.surface,
  projectId: props.projectId,
  repository: props.subject,
}));
commands.scope.registerCommand({
  id: props.commandId,
  title: `Подключить ${props.host}`,
  description: props.commandDescription,
  enabled: () => !busy.value && !!token.value.trim(),
  run: () =>
    action(async () => {
      await props.connect(token.value);
      token.value = "";
      emit("connected");
    }),
});
// What the agent reads on the connection tab: the subject and form state without the token.
useTabReadout(() => ({
  note: props.readoutNote,
  text: readoutLines(
    `${props.subjectLabel}: ${props.subject}`,
    busy.value ? "Состояние: подключение…" : "Состояние: не подключено",
    token.value.trim() ? "Токен: введён" : "Токен: не введён",
    error.value ? `Ошибка: ${error.value}` : "",
  ),
}));
</script>

<template>
  <section class="connection">
    <UiHeading>Подключить {{ host }}</UiHeading>
    <p>{{ intro ?? `Установите токен, чтобы открыть ${subject}.` }}</p>
    <slot name="hint" />
    <UiStack as="form" @submit.prevent="commands.run(commandId)">
      <UiLabel :for="tokenId" size="sm">Токен {{ host }}</UiLabel>
      <UiControl
        :id="tokenId"
        v-model="token"
        type="password"
        autocomplete="off"
        :placeholder="placeholder"
        :disabled="busy"
        required
      />
      <UiButton type="submit" :data-command="commandId" :disabled="busy || !token.trim()">{{
        busy ? "Подключаю…" : `Подключить ${host}`
      }}</UiButton>
    </UiStack>
    <UiMessage v-if="error" tone="danger" role="alert">{{ error }}</UiMessage>
    <a :href="tokenUrl" target="_blank" rel="noopener noreferrer">Создать токен в {{ host }} ↗</a>
  </section>
</template>

<style scoped>
.connection {
  max-width: 460px;
  padding: var(--sp-5);
}
p,
a {
  font-size: var(--fs-sm);
  color: var(--muted);
}
form {
  margin: var(--sp-4) 0;
}
input {
  min-width: 0;
}
form :deep(button) {
  justify-self: start;
}
a {
  text-decoration: underline;
}
</style>
