<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiSettingsSection from "../../../common/ui/UiSettingsSection.vue";
import AgentChatRoleCard from "./AgentChatRoleCard.vue";
import { watch } from "vue";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { roleControls } from "../model/roles.ts";
import { roleResources } from "../model/resources.ts";
import { useProjectRoleSettings } from "../model/project-roles.ts";
import type { AgentRole } from "@projector-ai/core/modules/agent-role/index.ts";
import type { Project } from "../../project/index.ts";

const props = defineProps<{ project: Project }>();
const {
  roles,
  trusted,
  file,
  exists,
  problem,
  busy,
  error,
  load,
  trust,
  create,
  save,
  remove,
  commands,
} = useProjectRoleSettings(() => props.project.id);
const activate = () => commands.scope.activate();
const agents = clientAgents();
const projectResources = () => roleResources(props.project.id);

watch(
  () => props.project.id,
  () => void load().catch(() => undefined),
  { immediate: true },
);

async function addRole() {
  await create().catch(() => undefined);
}

async function saveRole(role: { id: string }, value: Partial<AgentRole>) {
  await save(role.id, value).catch(() => undefined);
}

async function removeRole(role: { id: string }) {
  await remove(role.id).catch(() => undefined);
}

async function setTrust(value: boolean) {
  await trust(value).catch(() => undefined);
}
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error" class="project-roles">
    <div class="head">
      <UiInline wrap :gap="2">
        <span class="file">{{ file || ".projector/roles.json" }}</span>
        <span v-if="trusted" class="trusted">доверено</span>
        <span v-else-if="exists" class="untrusted">не доверено</span>
        <span v-else class="untrusted">файла ещё нет</span>
      </UiInline>
      <UiInline :gap="2">
        <UiButton
          v-if="exists && !trusted"
          appearance="solid"
          size="sm"
          :busy="busy === 'trust'"
          :disabled="!!problem"
          @click="setTrust(true)"
          >Доверять</UiButton
        >
        <UiButton
          v-else-if="trusted"
          appearance="outline"
          size="sm"
          :busy="busy === 'trust'"
          @click="setTrust(false)"
          >Отозвать доверие</UiButton
        >
        <UiButton
          appearance="outline"
          size="sm"
          :busy="busy === 'new'"
          :disabled="!!busy"
          @click="addRole"
          >Добавить роль</UiButton
        >
      </UiInline>
    </div>
    <UiMessage v-if="problem" tone="danger" size="xs" flush role="alert">{{ problem }}</UiMessage>
    <UiMessage v-else-if="exists && !trusted" tone="muted" variant="note" size="xs" flush>
      Роли из этого файла не открываются в чатах, заданиях и task. Проверьте файл и выдайте доверие.
    </UiMessage>
    <p v-if="!roles.length && !problem" class="empty">
      В файле пока нет ролей. Добавьте роль — она появится в меню «+» после доверия.
    </p>
    <AgentChatRoleCard
      v-for="role in roles"
      :key="role.id"
      :role="role"
      :agents="agents"
      :controls-for="roleControls"
      :resources-for="projectResources"
      :busy="busy === role.id"
      @save="(value) => saveRole(role, value)"
      @remove="removeRole(role)"
    />
    <UiHint>
      Роли проекта действуют только в этом проекте. Доверие привязано к хешу файла; после изменения
      файла его нужно выдать заново.
    </UiHint>
  </UiSettingsSection>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.file {
  min-width: 0;
  color: var(--faint);
  font: var(--fs-2xs) var(--mono);
  overflow-wrap: anywhere;
}
.trusted {
  color: var(--run);
  font-size: var(--fs-2xs);
}
.untrusted {
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.empty {
  margin: 0;
  padding: var(--sp-3);
  border: 1px dashed var(--line);
  border-radius: var(--r-md);
  color: var(--muted);
  font-size: var(--fs-xs);
}
</style>
