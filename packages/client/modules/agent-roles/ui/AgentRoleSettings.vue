<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import AgentChatRoleCard from "./AgentChatRoleCard.vue";
import { onMounted, ref, watch } from "vue";
import { useAgentRoleSettings } from "../model/roles.ts";
import { roleResources } from "../model/resources.ts";

const {
  serviceRoles,
  chatRoles,
  agents,
  file,
  modelOptions,
  controlsFor,
  busy,
  error,
  load,
  setService,
  resetService,
  createChat,
  saveChat,
  removeChat,
  commands,
} = useAgentRoleSettings();
const drafts = ref<Record<string, string>>({});

const providerOf = (role: { id: string; selection?: Record<string, string> }) =>
  drafts.value[role.id] ?? role.selection?.provider ?? "";

function choose(role: { id: string }, event: Event) {
  drafts.value = {
    ...drafts.value,
    [role.id]: (event.target as HTMLSelectElement).value,
  };
}

/** A saved model may have disappeared from the provider list; keep it visible with a warning. */
function optionsFor(role: { id: string; selection?: Record<string, string> }) {
  const value = providerOf(role);
  const options = modelOptions.value;
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, name: `${value} — недоступна` }];
}

async function saveServiceRole(role: { id: string }) {
  await setService(role.id, providerOf(role)).catch(() => undefined);
  const next = { ...drafts.value };
  delete next[role.id];
  drafts.value = next;
}

async function resetServiceRole(role: { id: string }) {
  await resetService(role.id).catch(() => undefined);
  const next = { ...drafts.value };
  delete next[role.id];
  drafts.value = next;
}

async function addChatRole() {
  await createChat().catch(() => undefined);
}

async function saveChatRole(role: { id: string }, value: Parameters<typeof saveChat>[1]) {
  await saveChat(role.id, value).catch(() => undefined);
}

async function removeChatRole(role: { id: string }) {
  await removeChat(role.id).catch(() => undefined);
}

watch(
  serviceRoles,
  (list) => {
    const next = { ...drafts.value };
    for (const role of list) if (!(role.id in next)) next[role.id] = role.selection.provider ?? "";
    drafts.value = next;
  },
  { immediate: true },
);

onMounted(() => void load().catch(() => undefined));
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <div class="section-head">
      <h3>Служебные роли</h3>
      <p>
        Доктор, Lens и Судья выполняют один короткий запрос без инструментов. Выбранная модель
        действует только на эти вызовы.
      </p>
    </div>
    <UiCard
      v-for="role in serviceRoles"
      :key="role.id"
      as="section"
      appearance="frame"
      class="role"
    >
      <h4>{{ role.name }}</h4>
      <p class="summary">{{ role.description }}</p>
      <UiField v-slot="{ control }" label="модель">
        <UiControl
          as="select"
          v-bind="control"
          :value="providerOf(role)"
          :disabled="busy === role.id"
          @change="choose(role, $event)"
        >
          <option value="">Как в чате</option>
          <option v-for="option in optionsFor(role)" :key="option.value" :value="option.value">
            {{ option.name }}
          </option>
        </UiControl>
      </UiField>
      <UiInline>
        <UiButton
          appearance="solid"
          size="sm"
          :busy="busy === role.id"
          :disabled="busy === role.id"
          @click="saveServiceRole(role)"
          >Сохранить</UiButton
        >
        <UiButton
          appearance="outline"
          size="sm"
          :disabled="busy === role.id || (!role.selection.provider && !drafts[role.id])"
          @click="resetServiceRole(role)"
          >Как в чате</UiButton
        >
      </UiInline>
      <UiHint v-if="!providerOf(role)">
        Модель берётся из чата, а если её там нет — у активного провайдера.
      </UiHint>
    </UiCard>

    <div class="section-head roles-head">
      <div>
        <h3>Роли чатов</h3>
        <p>
          Пресет агента, модели и его настроек. Роль открывается из меню «+» и действует на новый
          чат; уже начатые чаты сохраняют свой снимок.
        </p>
      </div>
      <UiButton
        appearance="outline"
        size="sm"
        :busy="busy === 'new'"
        :disabled="!!busy"
        @click="addChatRole"
        >Добавить роль</UiButton
      >
    </div>
    <p v-if="!chatRoles.length" class="empty">
      Ролей чатов пока нет. Добавьте роль, выберите агента и настройки — она появится в меню новой
      сессии.
    </p>
    <AgentChatRoleCard
      v-for="role in chatRoles"
      :key="role.id"
      :role="role"
      :agents="agents"
      :controls-for="controlsFor"
      :resources-for="roleResources"
      :busy="busy === role.id"
      @save="(value) => saveChatRole(role, value)"
      @remove="removeChatRole(role)"
    />
    <UiHint>
      Служебные роли не меняют модель чатов. Файл настроек: <code>{{ file }}</code>
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>

<style scoped>
.section-head {
  display: grid;
  gap: 2px;
}
.section-head.roles-head {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--sp-3);
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
}
h3 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
}
h4 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.section-head p,
.summary,
.empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.role {
  display: grid;
  gap: var(--sp-3);
}
.empty {
  padding: var(--sp-3);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
}
code {
  overflow-wrap: anywhere;
}
</style>
