<script setup lang="ts">
import UiHint from "../../../../common/ui/UiHint.vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";
import IconPlus from "~icons/lucide/plus";
import IconTrash from "~icons/lucide/trash-2";

const form = useProjectSettingsForm();
const { draft, busy, discovering, discovered, candidates, selected } = form;
</script>

<template>
  <fieldset class="section" :disabled="busy">
    <div class="bar">
      <UiHint>Запускаются в терминале из папки проекта.</UiHint>
      <UiButton :disabled="discovering" @click="form.discover">{{
        discovering ? "читаю…" : "из package.json"
      }}</UiButton>
    </div>
    <div v-if="discovered !== null" class="script-picker">
      <template v-if="candidates.length">
        <label v-for="command in candidates" :key="command.id" class="script-option">
          <input v-model="selected" type="checkbox" :value="command.id" />
          <span>{{ command.name }}</span
          ><code>{{ command.cmd }}</code>
        </label>
        <div class="picker-actions">
          <UiButton :disabled="!selected.length" @click="form.importCommands"
            >Добавить выбранные</UiButton
          >
          <UiButton @click="discovered = null">Отмена</UiButton>
        </div>
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
    <div class="commands">
      <div v-for="(command, index) in draft.commands" :key="command.id" class="command">
        <label class="field"
          >Название<input
            v-model="command.name"
            :aria-label="`Название команды ${index + 1}`"
            required
            placeholder="dev"
        /></label>
        <label class="field command-input"
          >Команда запуска<input
            v-model="command.cmd"
            :aria-label="`Команда запуска ${index + 1}`"
            class="command-text"
            required
            placeholder="pnpm dev"
            spellcheck="false"
        /></label>
        <UiButton
          variant="ghost"
          :disabled="draft.commands.length === 1"
          :aria-label="`Удалить команду ${command.name || index + 1}`"
          :title="draft.commands.length === 1 ? 'Нужна хотя бы одна команда' : 'Удалить команду'"
          @click="form.removeCommand(command.id)"
          ><IconTrash aria-hidden="true"
        /></UiButton>
      </div>
    </div>
    <UiButton class="add-command" @click="form.addCommand"
      ><IconPlus aria-hidden="true" />Добавить команду</UiButton
    >
  </fieldset>
</template>

<style scoped>
.section {
  display: grid;
  gap: var(--sp-3);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.bar,
.picker-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--sp-3);
}
.field {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  color: var(--muted);
}
.commands {
  display: grid;
  gap: var(--sp-4);
}
.command {
  display: grid;
  grid-template-columns: minmax(90px, 1fr) minmax(140px, 3fr) 34px;
  gap: var(--sp-2);
}
.command button {
  align-self: end;
  padding: var(--sp-2);
}
.command-text {
  font-family: var(--mono);
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
.script-option {
  display: flex;
  gap: var(--sp-2);
  align-items: baseline;
}
.script-option input {
  width: auto;
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
