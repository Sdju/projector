<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiLabel from "../../../common/ui/UiLabel.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiSettingsSection from "../../../common/ui/UiSettingsSection.vue";
import { computed, onMounted, useId, watch } from "vue";
import {
  appearanceOptions,
  isAppearanceChoice,
  type AppearanceChoice,
} from "@ai-projector/core/modules/appearance/index.ts";
import { appearanceThemes, setAppearanceThemes } from "../appearance.ts";
import { useProjectAppearanceSettings } from "../model/project-settings.ts";
import type { Project } from "../../project/index.ts";

const props = defineProps<{ project: Project }>();
const choiceId = useId();
const chatId = useId();
const editorId = useId();
const terminalId = useId();
const { state, draft, ready, busy, error, status, min, max, commands, save, trust, setFont } =
  useProjectAppearanceSettings(() => props.project.id);

const activate = () => commands.scope.activate();
const exists = computed(() => !!state.value?.exists);
const trusted = computed(() => !!state.value?.trusted);
const problem = computed(() => state.value?.problem ?? "");
const file = computed(() => state.value?.file ?? ".projector/appearance.json");
const availableChoices = computed(() => [...appearanceOptions, ...appearanceThemes().value]);

onMounted(() => {
  void fetch("/api/appearance")
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok) return;
      setAppearanceThemes(
        (data.themes ?? []).filter((theme: { tokens?: unknown }) => theme.tokens !== undefined),
      );
    })
    .catch(() => undefined);
});

watch(
  () => props.project.id,
  () => void commands.scope.activate(),
);

function onChoice(value: string) {
  draft.value.choice =
    value === "" || isAppearanceChoice(value) ? (value as AppearanceChoice | "") : "";
}

async function setTrust(value: boolean) {
  await trust(value).catch(() => undefined);
}

async function saveOverride() {
  await save().catch(() => undefined);
}

function inheritLabel(value: number | "") {
  return value === "" ? "наследовать" : `${value}px`;
}
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error" class="project-appearance">
    <div class="head">
      <UiInline wrap :gap="2">
        <span class="file">{{ file }}</span>
        <span v-if="trusted" class="trusted">доверено</span>
        <span v-else-if="exists" class="untrusted">не доверено</span>
        <span v-else class="untrusted">файла ещё нет</span>
      </UiInline>
      <UiInline :gap="2">
        <UiButton
          v-if="exists && !trusted"
          appearance="solid"
          size="sm"
          :busy="!!busy"
          :disabled="!!problem"
          @click="setTrust(true)"
          >Доверять</UiButton
        >
        <UiButton
          v-else-if="trusted"
          appearance="outline"
          size="sm"
          :busy="!!busy"
          @click="setTrust(false)"
          >Отозвать доверие</UiButton
        >
      </UiInline>
    </div>
    <UiMessage v-if="problem" tone="danger" size="xs" flush role="alert">{{ problem }}</UiMessage>
    <UiMessage v-else-if="exists && !trusted" tone="muted" variant="note" size="xs" flush>
      Пока файл не доверен, действует глобальное оформление. После правок доверие нужно выдать
      снова.
    </UiMessage>

    <UiLabel :for="choiceId" :space-after="2">Цветовая схема</UiLabel>
    <UiControl
      as="select"
      :id="choiceId"
      :model-value="draft.choice"
      :disabled="!ready || !!busy"
      @update:model-value="onChoice(String($event))"
    >
      <option value="">Как в глобальных настройках</option>
      <option v-for="option in availableChoices" :key="option.id" :value="option.id">
        {{ option.title }}
      </option>
    </UiControl>

    <UiLabel :for="chatId" :space-before="4" :space-after="2"
      >Чат агента · {{ inheritLabel(draft.fonts.chat) }}</UiLabel
    >
    <UiInline :gap="2" align="center">
      <UiControl
        :id="chatId"
        type="range"
        :min="min"
        :max="max"
        :step="1"
        :model-value="draft.fonts.chat === '' ? 13 : draft.fonts.chat"
        :disabled="!ready || !!busy"
        @update:model-value="setFont('chat', Number($event))"
      />
      <UiButton size="sm" :disabled="draft.fonts.chat === ''" @click="setFont('chat', '')"
        >Наследовать</UiButton
      >
    </UiInline>

    <UiLabel :for="editorId" :space-before="3" :space-after="2"
      >Редактор · {{ inheritLabel(draft.fonts.editor) }}</UiLabel
    >
    <UiInline :gap="2" align="center">
      <UiControl
        :id="editorId"
        type="range"
        :min="min"
        :max="max"
        :step="1"
        :model-value="draft.fonts.editor === '' ? 13 : draft.fonts.editor"
        :disabled="!ready || !!busy"
        @update:model-value="setFont('editor', Number($event))"
      />
      <UiButton size="sm" :disabled="draft.fonts.editor === ''" @click="setFont('editor', '')"
        >Наследовать</UiButton
      >
    </UiInline>

    <UiLabel :for="terminalId" :space-before="3" :space-after="2"
      >Терминал · {{ inheritLabel(draft.fonts.terminal) }}</UiLabel
    >
    <UiInline :gap="2" align="center">
      <UiControl
        :id="terminalId"
        type="range"
        :min="min"
        :max="max"
        :step="1"
        :model-value="draft.fonts.terminal === '' ? 13 : draft.fonts.terminal"
        :disabled="!ready || !!busy"
        @update:model-value="setFont('terminal', Number($event))"
      />
      <UiButton size="sm" :disabled="draft.fonts.terminal === ''" @click="setFont('terminal', '')"
        >Наследовать</UiButton
      >
    </UiInline>

    <UiInline class="actions" :gap="2">
      <UiButton appearance="solid" :disabled="!ready || !!busy" @click="saveOverride"
        >Сохранить</UiButton
      >
    </UiInline>
    <UiMessage v-if="status" role="status" size="xs" flush>{{ status }}</UiMessage>
    <UiHint>
      Файл <code>.projector/appearance.json</code> можно закоммитить. Незаданные поля наследуют
      глобальные настройки. Override применяется только после доверия к хешу файла.
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
  margin-bottom: var(--sp-3);
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
.actions {
  margin-top: var(--sp-4);
}
input[type="range"] {
  max-width: 280px;
  flex: 1;
}
</style>
