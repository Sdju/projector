<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import AgentChatRoleCard from "./AgentChatRoleCard.vue";
import { onMounted, ref, watch } from "vue";
import { useProjects } from "../../project/index.ts";
import { clientAgents } from "../../agents-integration/catalog/index.ts";
import { roleControls } from "../model/roles.ts";
import { useProjectRoleSettings } from "../model/project-roles.ts";
import type { AgentRole } from "@projector/core/modules/agent-role/index.ts";

const projects = useProjects();
const selected = ref("");
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
} = useProjectRoleSettings(() => selected.value);
const agents = clientAgents();

function chooseProject(event: Event) {
  selected.value = (event.target as HTMLSelectElement).value;
}

watch(selected, () => void load().catch(() => undefined));

onMounted(async () => {
  if (!projects.projects.value.length) await projects.load();
  selected.value = projects.projects.value[0]?.id ?? "";
});

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
  <UiStack
    as="section"
    :gap="4"
    class="project-roles"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <div class="head">
      <div>
        <h3>Роли проекта</h3>
        <p>
          Файл ролей лежит в проекте и не используется, пока вы не доверите его текущему
          содержимому. Правка файла автоматически отзывает доверие.
        </p>
      </div>
      <UiButton
        appearance="outline"
        size="sm"
        :busy="busy === 'new'"
        :disabled="!!busy || !selected"
        @click="addRole"
        >Добавить роль</UiButton
      >
    </div>
    <UiField v-if="projects.projects.value.length" v-slot="{ control }" label="проект">
      <UiControl as="select" v-bind="control" :value="selected" @change="chooseProject">
        <option v-for="project in projects.projects.value" :key="project.id" :value="project.id">
          {{ project.name }} · {{ project.path }}
        </option>
      </UiControl>
    </UiField>
    <UiHint v-else>В каталоге нет проектов: роли проекта появятся после добавления проекта.</UiHint>
    <template v-if="selected">
      <UiInline wrap>
        <span class="file">{{ file || ".projector/roles.json" }}</span>
        <span v-if="trusted" class="trusted">доверено</span>
        <span v-else-if="exists" class="untrusted">не доверено</span>
        <span v-else class="untrusted">файла ещё нет</span>
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
      </UiInline>
      <UiMessage v-if="problem" tone="danger" size="xs" flush role="alert">{{ problem }}</UiMessage>
      <UiMessage v-else-if="exists && !trusted" tone="muted" variant="note" size="xs" flush>
        Роли из этого файла не открываются в чатах, заданиях и task. Проверьте файл и выдайте
        доверие.
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
        :busy="busy === role.id"
        @save="(value) => saveRole(role, value)"
        @remove="removeRole(role)"
      />
      <UiHint>
        Роли проекта действуют только в этом проекте. Доверие привязано к хешу файла; после
        изменения файла его нужно выдать заново.
      </UiHint>
    </template>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>

<style scoped>
.project-roles {
  padding-top: var(--sp-2);
  border-top: 1px solid var(--line);
}
.head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--sp-3);
}
h3 {
  margin: 0;
  color: var(--text);
  font-size: var(--fs-sm);
  font-weight: 600;
}
.head p {
  margin: 2px 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
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
