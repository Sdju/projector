<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiSettingsSection from "../../../common/ui/UiSettingsSection.vue";
import AgentChatRoleCard from "./AgentChatRoleCard.vue";
import { onMounted, ref, watch } from "vue";
import { formatMediaPrice } from "@ai-projector/core/modules/media/index.ts";
import { mediaModelSelection } from "@ai-projector/core/modules/agent-role/index.ts";
import { useAgentRoleSettings } from "../model/roles.ts";
import { roleResources } from "../model/resources.ts";

const {
  serviceRoles,
  chatRoles,
  agents,
  file,
  modelOptions,
  mediaOptionsFor,
  mediaModelOf,
  listener,
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
const activate = () => commands.scope.activate();
const drafts = ref<Record<string, string>>({});
const contexts = ref<Record<string, string>>({});

const providerOf = (role: { id: string; selection?: Record<string, string> }) =>
  drafts.value[role.id] ?? role.selection?.provider ?? "";

const contextOf = (role: { id: string; prompt?: string }) =>
  contexts.value[role.id] ?? role.prompt ?? "";

function choose(role: { id: string }, event: Event) {
  drafts.value = {
    ...drafts.value,
    [role.id]: (event.target as HTMLSelectElement).value,
  };
}

function editContext(role: { id: string }, event: Event) {
  contexts.value = {
    ...contexts.value,
    [role.id]: (event.target as HTMLTextAreaElement).value,
  };
}

type ServiceRole = (typeof serviceRoles.value)[number];

/** Media models in provider groups: the same model id may be offered by two providers. */
function mediaGroups(role: ServiceRole) {
  const current = providerOf(role);
  const groups = new Map<
    string,
    { id: string; providerName: string; options: { value: string; name: string }[] }
  >();
  for (const option of mediaOptionsFor(role)) {
    const group = groups.get(option.providerId) ?? {
      id: option.providerId,
      providerName: option.providerName,
      options: [],
    };
    group.options.push({ value: option.value, name: option.name });
    groups.set(option.providerId, group);
  }
  // A saved model may have disappeared from the catalog; keep it selectable with a warning.
  if (current && !mediaOptionsFor(role).some((option) => option.value === current))
    return [
      ...groups.values(),
      {
        id: "saved",
        providerName: "Сохранённая модель",
        options: [{ value: current, name: `${current} — недоступна` }],
      },
    ];
  return [...groups.values()];
}

/** A saved model may have disappeared from the provider list; keep it visible with a warning. */
function optionsFor(role: ServiceRole) {
  const value = providerOf(role);
  const options = modelOptions.value;
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, name: `${value} — недоступна` }];
}

/** Whether the card has something to reset: a saved choice, its context or an unsaved edit. */
function canReset(role: ServiceRole) {
  return (
    !!role.selection.provider ||
    !!role.prompt ||
    !!drafts.value[role.id] ||
    !!contexts.value[role.id]
  );
}

/** The model the role would call now: its own choice, or Listener's automatic resolution. */
function activeModel(role: ServiceRole) {
  if (!role.media) return undefined;
  const chosen = mediaModelSelection(role.selection);
  if (chosen) return mediaModelOf(chosen.providerId, chosen.model);
  if (role.id === "listener" && listener.value?.providerId && listener.value.model)
    return mediaModelOf(listener.value.providerId, listener.value.model);
  return undefined;
}

/** One line about the model under the card: what it is and what it costs. */
function mediaSummary(role: ServiceRole): string {
  const model = activeModel(role);
  if (!model) return "";
  const prices = (model.prices ?? []).map((price) => formatMediaPrice(price)).join(" · ");
  return [model.description, prices].filter(Boolean).join(" · ");
}

async function saveServiceRole(role: ServiceRole) {
  await setService(role.id, providerOf(role), role.media ? contextOf(role) : undefined).catch(
    () => undefined,
  );
  const next = { ...drafts.value };
  delete next[role.id];
  drafts.value = next;
  const nextContexts = { ...contexts.value };
  delete nextContexts[role.id];
  contexts.value = nextContexts;
}

async function resetServiceRole(role: ServiceRole) {
  await resetService(role.id).catch(() => undefined);
  const next = { ...drafts.value };
  delete next[role.id];
  drafts.value = next;
  const nextContexts = { ...contexts.value };
  delete nextContexts[role.id];
  contexts.value = nextContexts;
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
  <UiSettingsSection :activate="activate" :error="error">
    <div class="section-head">
      <h3>Служебные роли</h3>
      <p>
        Доктор, Lens и Судья выполняют один короткий запрос без инструментов, Listener распознаёт
        речь выбранной медиа-моделью. Выбор действует только на эти вызовы.
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
      <UiField v-slot="{ control }" :label="role.media ? 'модель распознавания' : 'модель'">
        <UiControl
          as="select"
          v-bind="control"
          :value="providerOf(role)"
          :disabled="busy === role.id"
          @change="choose(role, $event)"
        >
          <option value="">
            {{ role.media ? "Автоматически — первая доступная" : "Как в чате" }}
          </option>
          <template v-if="role.media">
            <optgroup
              v-for="group in mediaGroups(role)"
              :key="group.id"
              :label="group.providerName"
            >
              <option v-for="option in group.options" :key="option.value" :value="option.value">
                {{ option.name }}
              </option>
            </optgroup>
          </template>
          <template v-else>
            <option v-for="option in optionsFor(role)" :key="option.value" :value="option.value">
              {{ option.name }}
            </option>
          </template>
        </UiControl>
      </UiField>
      <UiField v-if="role.media" v-slot="{ control }" label="контекст">
        <UiControl
          as="textarea"
          v-bind="control"
          :value="contextOf(role)"
          rows="3"
          maxlength="1000"
          :disabled="busy === role.id"
          placeholder="Имена, термины, названия проектов"
          @input="editContext(role, $event)"
        />
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
          :disabled="busy === role.id || !canReset(role)"
          @click="resetServiceRole(role)"
          >{{ role.media ? "Автоматически" : "Как в чате" }}</UiButton
        >
      </UiInline>
      <UiHint v-if="!providerOf(role)">
        <template v-if="role.media">
          Модель берётся автоматически: первая доступная модель распознавания речи.
        </template>
        <template v-else>
          Модель берётся из чата, а если её там нет — у активного провайдера.
        </template>
      </UiHint>
      <UiHint v-if="role.media">
        <template v-if="!mediaOptionsFor(role).length">
          Моделей распознавания нет: включите провайдера с адаптером речи.
        </template>
        <template v-else-if="listener?.model">
          Сейчас: {{ listener.providerName }} · {{ listener.model
          }}{{ listener.auto ? " (автоматически)" : "" }}. Контекст уходит провайдеру как подсказка
          и не заменяет инструкции.
        </template>
      </UiHint>
      <UiHint v-if="role.media && mediaSummary(role)">{{ mediaSummary(role) }}</UiHint>
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
    <UiHint> Служебные роли не меняют модель чатов. Файл настроек: <code>{{ file }}</code> </UiHint>
  </UiSettingsSection>
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
