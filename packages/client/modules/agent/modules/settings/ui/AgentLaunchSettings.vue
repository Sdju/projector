<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiControl from "../../../../../common/ui/UiControl.vue";
import UiField from "../../../../../common/ui/UiField.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiSettingsSection from "../../../../../common/ui/UiSettingsSection.vue";
import {
  textFromArgs,
  useAgentLaunchSettings,
  type AgentLaunchDraft,
} from "../model/launch-settings.ts";

/** One ACP agent's machine-local command, arguments and environment. */
const props = defineProps<{ agentId: string }>();
const { settings, draft, argsTouched, argsEdited, view, busy, error, commands } =
  useAgentLaunchSettings(props.agentId);
const activate = () => commands.scope.activate();

function editCommand(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  draft.value.command = value;
  const trimmed = value.trim();
  if (!trimmed && !argsEdited.value) {
    draft.value.args = "";
    argsTouched.value = false;
    return;
  }
  if (!argsTouched.value && trimmed) draft.value.args = textFromArgs(view.value?.default.args);
}

function edit(key: keyof Pick<AgentLaunchDraft, "args" | "env">, event: Event): void {
  if (key === "args") {
    argsTouched.value = true;
    argsEdited.value = true;
  }
  draft.value[key] = (event.target as HTMLTextAreaElement).value;
}
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error">
    <template v-if="view">
      <UiField
        v-slot="{ control }"
        label="команда"
        hint="Имя в PATH или полный путь к исполняемому файлу."
      >
        <UiControl
          v-bind="control"
          mono
          spellcheck="false"
          :value="draft.command"
          :placeholder="view.default.command"
          :disabled="busy"
          @input="editCommand($event)"
        />
      </UiField>
      <UiField
        v-slot="{ control }"
        label="аргументы"
        hint="Один аргумент на строку. При своей команде подставляются базовые аргументы агента; очистите поле, чтобы запустить без аргументов."
      >
        <UiControl
          v-bind="control"
          as="textarea"
          rows="3"
          mono
          spellcheck="false"
          :value="draft.args"
          :placeholder="view.default.args.join(' ') || 'без аргументов'"
          :disabled="busy"
          @input="edit('args', $event)"
        />
      </UiField>
      <UiHint v-if="draft.command.trim() && !draft.args.trim() && view.default.args.length" wrap>
        Своя команда запустится без аргументов. Обычно агенту нужны:
        <code>{{ view.default.args.join(" ") }}</code>.
      </UiHint>
      <UiField
        v-slot="{ control }"
        label="переменные окружения"
        hint="KEY=value, по одной в строке. Пустое значение допустимо."
      >
        <UiControl
          v-bind="control"
          as="textarea"
          rows="3"
          mono
          spellcheck="false"
          :value="draft.env"
          placeholder="KEY=value"
          :disabled="busy"
          @input="edit('env', $event)"
        />
      </UiField>
      <UiInline wrap :gap="2">
        <UiButton appearance="solid" :disabled="busy" @click="commands.run('ide.agent.launch.set')"
          >Сохранить</UiButton
        >
        <UiButton :disabled="busy" @click="commands.run('ide.agent.launch.check')"
          >Проверить</UiButton
        >
        <UiButton :disabled="busy || !view.override" @click="commands.run('ide.agent.launch.reset')"
          >Вернуть по умолчанию</UiButton
        >
      </UiInline>
      <UiHint wrap>
        <template v-if="view.effective.found">
          Найдено: <code>{{ view.effective.path ?? view.effective.command }}</code>.
        </template>
        <template v-else>
          Не найдено: <code>{{ view.effective.command }}</code>. Укажите имя в PATH или полный путь.
        </template>
        Настройка действует только на этой машине. Файл:
        <code>{{ settings.file }}</code>
      </UiHint>
    </template>
    <UiHint v-else-if="!busy && !error">
      У этого агента нет ACP-запуска: команду нельзя переопределить настройками Projector.
    </UiHint>
  </UiSettingsSection>
</template>

<style scoped>
code {
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  overflow-wrap: anywhere;
}
</style>
