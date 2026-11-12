<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiSettingsSection from "../../../common/ui/UiSettingsSection.vue";
import AgentPresetCard from "./AgentPresetCard.vue";
import { computed, watch } from "vue";
import { useAgentPresetSettings } from "../model/settings.ts";
import type { AgentPresetDraft } from "@ai-projector/core/modules/agent-preset/index.ts";

const props = defineProps<{ project?: { id: string } }>();
const isProject = computed(() => !!props.project?.id);
const {
  presets,
  trusted,
  exists,
  file,
  problem,
  busy,
  error,
  load,
  create,
  save,
  remove,
  trust,
  commands,
} = useAgentPresetSettings({ projectId: () => props.project?.id ?? "" });
const activate = () => commands.scope.activate();

watch(
  () => props.project?.id,
  () => void load().catch(() => undefined),
  { immediate: true },
);

async function addPreset() {
  await create().catch(() => undefined);
}

async function savePreset(id: string, value: AgentPresetDraft) {
  await save(id, value).catch(() => undefined);
}

async function removePreset(id: string) {
  await remove(id).catch(() => undefined);
}

async function setTrust(value: boolean) {
  await trust(value).catch(() => undefined);
}
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error" class="agent-presets">
    <div class="section-head">
      <h3>{{ isProject ? "Пресеты проекта" : "Пресеты агента" }}</h3>
      <p>
        Готовые первые запросы для любого агента. Пресет показывается на пустом экране чата: обычный
        текст попадает в поле ввода, а форма открывается для заполнения.
      </p>
    </div>
    <div v-if="isProject" class="head">
      <UiInline wrap :gap="2">
        <span class="file">{{ file || ".projector/presets.json" }}</span>
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
      </UiInline>
    </div>
    <UiInline v-else>
      <span class="file">{{ file || "agent/presets.json" }}</span>
    </UiInline>
    <UiMessage v-if="problem" tone="danger" size="xs" flush role="alert">{{ problem }}</UiMessage>
    <UiMessage
      v-else-if="isProject && exists && !trusted"
      tone="muted"
      variant="note"
      size="xs"
      flush
    >
      Пресеты из этого файла не появляются на стартовом экране. Проверьте файл и выдайте доверие.
    </UiMessage>
    <div class="actions">
      <UiButton
        appearance="outline"
        size="sm"
        :busy="busy === 'new'"
        :disabled="!!busy"
        @click="addPreset"
        >Добавить пресет</UiButton
      >
    </div>
    <p v-if="!presets.length && !problem" class="empty">
      Пресетов пока нет. Добавьте запрос, который хотите предлагать в начале разговора.
    </p>
    <AgentPresetCard
      v-for="preset in presets"
      :key="preset.id"
      :preset="preset"
      :busy="busy === preset.id"
      @save="(value) => savePreset(preset.id, value)"
      @remove="removePreset(preset.id)"
    />
    <UiHint>
      {{
        isProject
          ? "Новый файл, созданный здесь или агентом, доверяется автоматически. Правка доверенного файла сохраняет доверие; изменения файла извне требуют выдать его заново."
          : "Личные пресеты доступны во всех проектах и у всех агентов. Формы выполняются как обычные формы ответа Projector."
      }}
    </UiHint>
  </UiSettingsSection>
</template>

<style scoped>
.section-head h3 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-sm);
  font-weight: 500;
}
.section-head p {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
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
.actions {
  display: flex;
  justify-content: flex-start;
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
