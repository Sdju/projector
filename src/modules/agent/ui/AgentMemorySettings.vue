<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useAgentMemorySettings } from "../model/memory-settings.ts";

const { memory, drafts, textOf, busy, error, commands } = useAgentMemorySettings();

function edit(key: string, event: Event): void {
  drafts.value[key] = (event.target as HTMLTextAreaElement).value;
}
</script>

<template>
  <UiStack
    as="section"
    :gap="4"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiField v-slot="{ control }" label="общие заметки">
      <UiControl
        v-bind="control"
        as="textarea"
        rows="5"
        aria-label="Общие заметки агента"
        spellcheck="false"
        placeholder="Например: отвечай коротко, пакеты ставь через pnpm"
        :value="textOf('user')"
        :disabled="busy"
        @input="edit('user', $event)"
      />
    </UiField>
    <UiButton
      appearance="solid"
      :disabled="busy || drafts.user === undefined"
      @click="commands.run('ide.agent.memory.set')"
      >Сохранить</UiButton
    >
    <UiField
      v-for="project in memory.projects"
      :key="project.path"
      v-slot="{ control }"
      :label="project.path"
    >
      <UiControl
        v-bind="control"
        as="textarea"
        rows="4"
        :aria-label="`Заметки проекта ${project.path}`"
        spellcheck="false"
        :value="textOf(project.path)"
        :disabled="busy"
        @input="edit(project.path, $event)"
      />
      <UiButton
        :disabled="busy || drafts[project.path] === undefined"
        @click="
          commands.run('ide.agent.memory.set', { path: project.path, text: textOf(project.path) })
        "
        >Сохранить</UiButton
      >
      <UiButton
        :disabled="busy"
        @click="commands.run('ide.agent.memory.set', { path: project.path, text: '' })"
        >Удалить</UiButton
      >
    </UiField>
    <UiHint>
      Штатный агент попросит подтверждение и запишет сюда то, что вы просили запомнить («запомни…»).
      Заметки идут в каждый его запрос, поэтому держите их короткими; секреты здесь хранить не
      нужно. Заметки проекта привязаны к его пути.
    </UiHint>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
