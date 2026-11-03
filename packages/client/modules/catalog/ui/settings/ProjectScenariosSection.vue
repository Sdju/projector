<script setup lang="ts">
import { computed } from "vue";
import UiControl from "../../../../common/ui/UiControl.vue";
import UiInline from "../../../../common/ui/UiInline.vue";
import UiStack from "../../../../common/ui/UiStack.vue";
import UiField from "../../../../common/ui/UiField.vue";
import UiHint from "../../../../common/ui/UiHint.vue";
import UiButton from "../../../../common/ui/UiButton.vue";
import UiMessage from "../../../../common/ui/UiMessage.vue";
import UiDisclosureSummary from "../../../../common/ui/UiDisclosureSummary.vue";
import { useProjectSettingsForm } from "../../model/project-settings-form.ts";
import { projectSettingsSection, scenarioSection } from "../../model/project-settings-nav.ts";
import type { LaunchMode, ProjectCommand } from "../../../project/index.ts";
import IconPlus from "~icons/lucide/plus";
import IconTrash from "~icons/lucide/trash-2";
import IconCopy from "~icons/lucide/copy";
import IconStar from "~icons/lucide/star";
import IconChevron from "~icons/lucide/chevron-right";

/** The scenario whose page the navigation opened. Without one, the section shows the overview. */
const props = defineProps<{ scenarioId?: string }>();

const form = useProjectSettingsForm();
const { draft, busy, discovering, discovered, candidates, selected, dirty } = form;

const current = computed<ProjectCommand | undefined>(() =>
  draft.value.commands.find((command) => command.id === props.scenarioId),
);
const index = computed(() =>
  draft.value.commands.findIndex((item) => item.id === current.value?.id),
);
const isDefault = (command: ProjectCommand) => command.id === draft.value.defaultCommandId;
/** Folder, address and mode are rarely set; they open only when a scenario uses them. */
const hasExtras = (command: ProjectCommand) => !!(command.cwd || command.url || command.mode);

/** What a run of this scenario does, with the project's defaults filled in. */
const placeOf = (command: ProjectCommand) =>
  command.cwd ? `в папке ${command.cwd}` : "в корне проекта";
const modeOf = (command: ProjectCommand) =>
  (command.mode || draft.value.mode) === "window" ? "в окне приложения" : "в терминале";
const addressOf = (command: ProjectCommand) => command.url || draft.value.url || "не задан";

/** Opening a scenario goes through the navigation, so the page and its entry stay in step. */
function open(id: string | undefined) {
  projectSettingsSection.value = id ? scenarioSection(id) : "scenarios";
}
function addScenario() {
  form.addCommand();
  open(draft.value.commands.at(-1)?.id);
}
function duplicate(command: ProjectCommand) {
  form.duplicateCommand(command.id);
  open(draft.value.commands[index.value + 1]?.id);
}
/** Removing the scenario you are looking at returns to the list; the first scenario takes its place. */
function remove(command: ProjectCommand) {
  if (draft.value.commands.length <= 1) return;
  form.removeCommand(command.id);
  open(undefined);
}
</script>

<template>
  <UiStack as="fieldset" :disabled="busy" class="scenarios">
    <template v-if="!current">
      <UiInline :gap="3" justify="between" wrap>
        <UiHint>
          Порядок задаётся перетаскиванием пунктов в навигации слева: он виден в меню запуска.
        </UiHint>
        <UiInline :gap="2">
          <UiButton size="sm" @click="addScenario"
            ><IconPlus aria-hidden="true" />Добавить</UiButton
          >
          <UiButton :disabled="discovering" @click="form.discover">{{
            discovering ? "читаю…" : "из package.json"
          }}</UiButton>
        </UiInline>
      </UiInline>

      <div class="defaults">
        <UiField v-slot="{ control }" layout="plain" label="Адрес по умолчанию">
          <UiControl
            v-bind="control"
            v-model="draft.url"
            type="url"
            placeholder="для сценариев без своего адреса, например http://localhost:5173"
            spellcheck="false"
          />
        </UiField>
        <UiField v-slot="{ control }" layout="plain" label="Запуск по умолчанию">
          <UiControl
            v-bind="control"
            as="select"
            :model-value="draft.mode"
            @update:model-value="draft.mode = $event as LaunchMode"
          >
            <option value="server">в терминале</option>
            <option value="window">в окне приложения</option>
          </UiControl>
        </UiField>
      </div>

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
    </template>

    <section v-else :key="current.id" class="detail">
      <UiInline class="head" align="end" justify="normal">
        <UiField v-slot="{ control }" layout="plain" label="Название" required class="grow">
          <UiControl
            v-bind="control"
            v-model="current.name"
            class="name-input"
            :aria-label="`Название сценария ${index + 1}`"
            placeholder="dev"
          />
        </UiField>
        <UiButton
          size="sm"
          :appearance="isDefault(current) ? 'solid' : 'outline'"
          :aria-pressed="isDefault(current)"
          :title="isDefault(current) ? 'Основной сценарий' : 'Сделать основным'"
          @click="form.setDefaultCommand(current.id)"
        >
          <IconStar aria-hidden="true" />{{ isDefault(current) ? "Основной" : "Сделать основным" }}
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          aria-label="Дублировать сценарий"
          title="Дублировать"
          @click="duplicate(current)"
          ><IconCopy aria-hidden="true"
        /></UiButton>
        <UiButton
          shape="icon"
          size="sm"
          :disabled="draft.commands.length <= 1"
          aria-label="Удалить сценарий"
          :title="draft.commands.length <= 1 ? 'Нужен хотя бы один сценарий' : 'Удалить сценарий'"
          @click="remove(current)"
          ><IconTrash aria-hidden="true"
        /></UiButton>
      </UiInline>

      <UiField v-slot="{ control }" layout="plain" label="Команда запуска" required>
        <UiControl
          v-bind="control"
          v-model="current.cmd"
          :aria-label="`Команда запуска ${index + 1}`"
          mono
          placeholder="pnpm dev"
          spellcheck="false"
        />
      </UiField>
      <p class="summary" aria-live="polite">
        Запустится {{ placeOf(current) }}, {{ modeOf(current) }}, адрес
        <code>{{ addressOf(current) }}</code>
      </p>

      <details class="more" :open="hasExtras(current)">
        <UiDisclosureSummary variant="fit"
          ><IconChevron class="chevron" aria-hidden="true" />Дополнительно</UiDisclosureSummary
        >
        <div class="options">
          <UiField v-slot="{ control }" layout="plain" label="Папка">
            <UiControl
              v-bind="control"
              v-model="current.cwd"
              :aria-label="`Папка сценария ${index + 1}`"
              mono
              placeholder="корень проекта"
              spellcheck="false"
            />
          </UiField>
          <UiField v-slot="{ control }" layout="plain" label="Адрес">
            <UiControl
              v-bind="control"
              v-model="current.url"
              :aria-label="`Адрес сценария ${index + 1}`"
              mono
              :placeholder="draft.url ? 'из проекта' : 'не задан'"
              spellcheck="false"
            />
          </UiField>
          <UiField v-slot="{ control }" layout="plain" label="Запуск">
            <UiControl
              v-bind="control"
              :model-value="current.mode ?? ''"
              as="select"
              :aria-label="`Режим сценария ${index + 1}`"
              @update:model-value="current.mode = ($event || undefined) as LaunchMode | undefined"
            >
              <option value="">как у проекта</option>
              <option value="server">в терминале</option>
              <option value="window">в окне приложения</option>
            </UiControl>
          </UiField>
        </div>
      </details>

      <UiMessage v-if="form.problemOf(current.id)" tone="danger" size="xs" role="alert">
        {{ form.problemOf(current.id) }}
      </UiMessage>
      <UiHint v-if="dirty">Сохраните изменения, чтобы они применились к запуску.</UiHint>
    </section>
  </UiStack>
</template>

<style scoped>
/* Both fields share one height, so the row does not jump between the input and the select. */
.defaults {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--sp-3);
  min-width: 0;
}
.defaults :is(input, select) {
  height: var(--control-h);
}
.summary {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.summary code {
  color: var(--text);
  font-family: var(--mono);
}
.detail {
  display: grid;
  gap: var(--sp-3);
  align-content: start;
  min-width: 0;
}
.head {
  min-width: 0;
}
.grow {
  flex: 1;
  min-width: 0;
}
.more {
  display: grid;
  gap: var(--sp-3);
}
.chevron {
  transition: transform var(--t-fast);
}
.more[open] .chevron {
  transform: rotate(90deg);
}
.options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: var(--sp-3);
  min-width: 0;
}
.options > :last-child {
  grid-column: 1 / -1;
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
</style>
