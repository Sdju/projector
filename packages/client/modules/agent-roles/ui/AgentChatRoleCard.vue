<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { onMounted, reactive, ref, watch } from "vue";
import type { ClientAgent } from "../../agents-integration/catalog/index.ts";
import type { RoleControl } from "../model/roles.ts";
import type { RoleMcpServer, RoleResources, RoleSkill } from "../model/resources.ts";
import type {
  AgentRole,
  AgentRoleSelection,
  AgentRoleView,
} from "@projector/core/modules/agent-role/index.ts";

const props = defineProps<{
  role: AgentRoleView;
  agents: ClientAgent[];
  controlsFor: (agent: string) => Promise<RoleControl[]>;
  resourcesFor: () => Promise<RoleResources>;
  busy: boolean;
}>();
const emit = defineEmits<{ save: [value: Partial<AgentRole>]; remove: [] }>();

type ResourceMode = "all" | "some" | "none";

const draft = reactive({
  name: "",
  description: "",
  agent: "projector",
  selection: {} as AgentRoleSelection,
  prompt: "",
  skillsMode: "all" as ResourceMode,
  skills: [] as string[],
  mcpMode: "all" as ResourceMode,
  mcp: [] as string[],
});
const controls = ref<RoleControl[]>([]);
const resources = ref<RoleResources>({ skills: [], mcp: [] });
const loading = ref(false);
const resourcesLoading = ref(false);
const error = ref("");

function modeOf(names: string[] | undefined): ResourceMode {
  if (names === undefined) return "all";
  return names.length ? "some" : "none";
}

function adopt(role: AgentRoleView) {
  draft.name = role.name;
  draft.description = role.description ?? "";
  draft.agent = role.agent;
  draft.selection = { ...role.selection };
  draft.prompt = role.prompt ?? "";
  draft.skillsMode = modeOf(role.skills);
  draft.skills = [...(role.skills ?? [])];
  draft.mcpMode = modeOf(role.mcp);
  draft.mcp = [...(role.mcp ?? [])];
  void loadControls(role.agent);
}

async function loadControls(agent: string) {
  loading.value = true;
  error.value = "";
  try {
    controls.value = await props.controlsFor(agent);
  } catch (cause) {
    controls.value = [];
    error.value = cause instanceof Error ? cause.message : "Не удалось получить настройки агента";
  } finally {
    loading.value = false;
  }
}

async function loadResources() {
  resourcesLoading.value = true;
  try {
    resources.value = await props.resourcesFor();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : "Не удалось получить навыки и MCP-серверы";
  } finally {
    resourcesLoading.value = false;
  }
}

watch(() => props.role, adopt, { immediate: true });
onMounted(() => void loadResources());

function chooseAgent(event: Event) {
  const agent = (event.target as HTMLSelectElement).value;
  if (agent === draft.agent) return;
  draft.agent = agent;
  // Settings of another agent usually have other ids: keep only what exists after loading.
  draft.selection = {};
  void loadControls(agent);
}

function valueOf(control: RoleControl): string {
  return draft.selection[control.id] ?? "";
}

function chooseControl(control: RoleControl, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (value) draft.selection = { ...draft.selection, [control.id]: value };
  else {
    const next = { ...draft.selection };
    delete next[control.id];
    draft.selection = next;
  }
}

/** A saved value may have disappeared from the agent's current options; keep it visible. */
function optionsFor(control: RoleControl) {
  const value = valueOf(control);
  if (!value || control.options.some((option) => option.value === value)) return control.options;
  return [...control.options, { value, name: `${value} — недоступно` }];
}

/** A selected name may no longer exist; keep it visible so saving does not silently drop it. */
function skillChoices(): RoleSkill[] {
  const known = new Set(resources.value.skills.map((skill) => skill.name));
  return [
    ...resources.value.skills,
    ...draft.skills
      .filter((name) => !known.has(name))
      .map((name) => ({
        name,
        description: "недоступен в этом проекте",
        kind: "skill" as const,
        source: "user" as const,
      })),
  ];
}

function mcpChoices(): RoleMcpServer[] {
  const known = new Set(resources.value.mcp.map((server) => server.name));
  return [
    ...resources.value.mcp,
    ...draft.mcp
      .filter((name) => !known.has(name))
      .map((name) => ({
        name,
        source: "user" as const,
        kind: "stdio" as const,
      })),
  ];
}

function toggleSkill(name: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  draft.skills = checked
    ? [...new Set([...draft.skills, name])]
    : draft.skills.filter((item) => item !== name);
}

function toggleMcp(name: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked;
  draft.mcp = checked
    ? [...new Set([...draft.mcp, name])]
    : draft.mcp.filter((item) => item !== name);
}

function resourceValue(mode: ResourceMode, names: string[]): string[] | undefined {
  if (mode === "all") return undefined;
  if (mode === "none") return [];
  return [...names];
}

function save() {
  if (!draft.name.trim()) {
    error.value = "Укажите название роли";
    return;
  }
  const skills = resourceValue(draft.skillsMode, draft.skills);
  const mcp = resourceValue(draft.mcpMode, draft.mcp);
  emit("save", {
    name: draft.name.trim(),
    description: draft.description.trim(),
    agent: draft.agent,
    selection: { ...draft.selection },
    prompt: draft.prompt.trim(),
    ...(skills !== undefined ? { skills } : {}),
    ...(mcp !== undefined ? { mcp } : {}),
  });
}

function remove() {
  if (confirm(`Удалить роль «${props.role.name}»?`)) emit("remove");
}
</script>

<template>
  <UiCard as="section" appearance="frame" class="role">
    <div class="head">
      <span class="kicker">chat-роль</span>
      <span v-if="role.builtin" class="kicker">встроенная</span>
    </div>
    <UiField v-slot="{ control }" label="название">
      <UiControl
        v-bind="control"
        :value="draft.name"
        :disabled="busy"
        @input="draft.name = ($event.target as HTMLInputElement).value"
      />
    </UiField>
    <UiField v-slot="{ control }" label="агент">
      <UiControl
        as="select"
        v-bind="control"
        :value="draft.agent"
        :disabled="busy"
        @change="chooseAgent"
      >
        <option v-for="agent in agents" :key="agent.backend" :value="agent.backend">
          {{ agent.title }}{{ agent.builtin ? " — встроенный" : "" }}
        </option>
      </UiControl>
    </UiField>
    <UiField v-slot="{ control }" label="описание">
      <UiControl
        v-bind="control"
        :value="draft.description"
        :disabled="busy"
        placeholder="Когда выбирать эту роль"
        @input="draft.description = ($event.target as HTMLInputElement).value"
      />
    </UiField>
    <UiField v-slot="{ control }" label="промпт роли">
      <UiControl
        as="textarea"
        v-bind="control"
        :value="draft.prompt"
        :disabled="busy"
        rows="4"
        placeholder="Дополнительные инструкции для этого чата"
        @input="draft.prompt = ($event.target as HTMLTextAreaElement).value"
      />
      <span class="control-hint">
        Добавляется к системному промпту агента; пустое поле ничего не меняет.
      </span>
    </UiField>
    <UiField v-slot="{ control }" label="навыки">
      <UiControl as="select" v-bind="control" v-model="draft.skillsMode" :disabled="busy">
        <option value="all">Все доступные</option>
        <option value="some">Только выбранные</option>
        <option value="none">Не добавлять</option>
      </UiControl>
    </UiField>
    <p v-if="resourcesLoading" class="note">Читаю навыки и MCP-серверы…</p>
    <div v-else-if="draft.skillsMode === 'some'" class="choices">
      <label v-for="skill in skillChoices()" :key="skill.name" class="choice">
        <UiControl
          type="checkbox"
          :checked="draft.skills.includes(skill.name)"
          :disabled="busy"
          :aria-label="`Навык ${skill.name}`"
          @change="toggleSkill(skill.name, $event)"
        />
        <span>
          <strong>{{ skill.name }}</strong>
          <small
            >{{ skill.kind === "command" ? "команда" : "навык" }} · {{ skill.description }}</small
          >
        </span>
      </label>
      <p v-if="!skillChoices().length" class="note">В этом проекте нет навыков.</p>
      <p v-else class="note">Ничего не выбрано — роль не получит навыков.</p>
    </div>
    <UiField v-slot="{ control }" label="MCP-серверы">
      <UiControl as="select" v-bind="control" v-model="draft.mcpMode" :disabled="busy">
        <option value="all">Все настроенные</option>
        <option value="some">Только выбранные</option>
        <option value="none">Не подключать</option>
      </UiControl>
    </UiField>
    <div v-if="draft.mcpMode === 'some' && !resourcesLoading" class="choices">
      <label v-for="server in mcpChoices()" :key="server.name" class="choice">
        <UiControl
          type="checkbox"
          :checked="draft.mcp.includes(server.name)"
          :disabled="busy"
          :aria-label="`MCP-сервер ${server.name}`"
          @change="toggleMcp(server.name, $event)"
        />
        <span>
          <strong>{{ server.name }}</strong>
          <small
            >{{ server.source === "project" ? "проект" : "пользователь" }} ·
            {{ server.kind }}</small
          >
        </span>
      </label>
      <p v-if="!mcpChoices().length" class="note">MCP-серверы не настроены.</p>
      <p v-else class="note">Ничего не выбрано — роль не подключит MCP.</p>
    </div>
    <p v-if="loading" class="note">Читаю настройки агента…</p>
    <template v-else>
      <UiField
        v-for="control in controls"
        :key="control.id"
        v-slot="{ control: field }"
        :label="control.name"
      >
        <UiControl
          as="select"
          v-bind="field"
          :value="valueOf(control)"
          :disabled="busy"
          @change="chooseControl(control, $event)"
        >
          <option value="">По умолчанию агента</option>
          <option v-for="option in optionsFor(control)" :key="option.value" :value="option.value">
            {{ option.name }}
          </option>
        </UiControl>
        <template v-if="control.description">
          <span class="control-hint">{{ control.description }}</span>
        </template>
      </UiField>
      <p v-if="!controls.length && !error" class="note">
        У этого агента нет настроек для роли: чат начнётся с его умолчаний.
      </p>
    </template>
    <UiInline>
      <UiButton appearance="solid" size="sm" :busy="busy" :disabled="busy" @click="save"
        >Сохранить</UiButton
      >
      <UiButton appearance="outline" size="sm" :disabled="busy" @click="remove">Удалить</UiButton>
    </UiInline>
    <UiHint>
      Роль применяется к новому чату и сохраняется в его истории. Изменение роли не меняет уже
      начатые чаты; пустое значение наследует умолчание агента. Projector ограничивает навыки
      выбором роли; внешний агент получает выбранные навыки путями к файлам, но свои нативные навыки
      сохраняет.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiCard>
</template>

<style scoped>
.role {
  display: grid;
  gap: var(--sp-3);
}
.head {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}
.kicker {
  color: var(--faint);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
}
.note {
  margin: 0;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.control-hint {
  color: var(--faint);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.choices {
  display: grid;
  gap: var(--sp-2);
  padding: var(--sp-2) 0;
}
.choice {
  display: flex;
  gap: var(--sp-2);
  align-items: flex-start;
  cursor: pointer;
}
.choice :deep(input) {
  margin-top: 2px;
}
.choice strong {
  display: block;
  font-weight: 500;
  font-size: var(--fs-xs);
}
.choice small {
  display: block;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
</style>
