<script setup lang="ts">
import UiControl from "../../../../common/ui/UiControl.vue";
import UiInline from "../../../../common/ui/UiInline.vue";
import UiStack from "../../../../common/ui/UiStack.vue";
import UiField from "../../../../common/ui/UiField.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";
import IconPlus from "~icons/lucide/plus";
import IconTrash from "~icons/lucide/trash-2";

const form = useProjectSettingsForm();
const { draft, busy, discovering, discovered, candidates, selected } = form;
</script>

<template>
  <UiStack as="fieldset" :disabled="busy">
    <UiInline :gap="3" justify="between" wrap>
      <UiHint>Запускаются в терминале из папки проекта.</UiHint>
      <UiButton :disabled="discovering" @click="form.discover">{{
        discovering ? "читаю…" : "из package.json"
      }}</UiButton>
    </UiInline>
    <div v-if="discovered !== null" class="script-picker">
      <template v-if="candidates.length">
        <UiInline
          as="label"
          v-for="command in candidates"
          :key="command.id"
          class="script-option"
          align="baseline"
          justify="normal"
        >
          <UiControl v-model="selected" type="checkbox" :value="command.id" />
          <span>{{ command.name }}</span
          ><code>{{ command.cmd }}</code>
        </UiInline>
        <UiInline class="picker-actions" :gap="3" justify="between" wrap>
          <UiButton :disabled="!selected.length" @click="form.importCommands"
            >Добавить выбранные</UiButton
          >
          <UiButton @click="discovered = null">Отмена</UiButton>
        </UiInline>
      </template>
      <template v-else>
        <UiHint>{{
          discovered.length
            ? "Все найденные команды уже добавлены."
            : "В этой папке нет скриптов package.json. Добавьте свою команду."
        }}</UiHint>
        <UiButton @click="discovered = null">Закрыть</UiButton>
      </template>
    </div>
    <UiStack :gap="4">
      <div v-for="(command, index) in draft.commands" :key="command.id" class="command">
        <UiField v-slot="{ control }" layout="plain" label="Название" required>
          <UiControl
            v-bind="control"
            v-model="command.name"
            :aria-label="`Название команды ${index + 1}`"
            placeholder="dev"
        /></UiField>
        <UiField
          v-slot="{ control }"
          class="command-input"
          layout="plain"
          label="Команда запуска"
          required
        >
          <UiControl
            v-bind="control"
            v-model="command.cmd"
            :aria-label="`Команда запуска ${index + 1}`"
            class="command-text"
            mono
            placeholder="pnpm dev"
            spellcheck="false"
        /></UiField>
        <UiButton
          :disabled="draft.commands.length === 1"
          :aria-label="`Удалить команду ${command.name || index + 1}`"
          :title="draft.commands.length === 1 ? 'Нужна хотя бы одна команда' : 'Удалить команду'"
          @click="form.removeCommand(command.id)"
          ><IconTrash aria-hidden="true"
        /></UiButton>
      </div>
    </UiStack>
    <UiButton class="add-command" @click="form.addCommand"
      ><IconPlus aria-hidden="true" />Добавить команду</UiButton
    >
  </UiStack>
</template>

<style scoped>
.command {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(140px, 3fr) 34px;
  gap: var(--sp-2);
}
.command button {
  align-self: end;
  padding: var(--sp-2);
}
.add-command {
  justify-self: start;
}
svg {
  width: 14px;
  height: 14px;
}
.script-picker {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
}
.script-option input {
  margin: var(--sp-1) 0 0;
  flex-shrink: 0;
}
.script-option code {
  margin-left: auto;
  color: var(--muted);
  overflow-wrap: anywhere;
  min-width: 0;
}
@container (max-width: 500px) {
  .command {
    grid-template-columns: minmax(0, 1fr) 34px;
  }
  .command-input {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .command button {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
