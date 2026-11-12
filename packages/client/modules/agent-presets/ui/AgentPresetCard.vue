<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import { reactive, watch } from "vue";
import type {
  AgentPreset,
  AgentPresetDraft,
} from "@ai-projector/core/modules/agent-preset/index.ts";

const props = defineProps<{ preset: AgentPreset; busy: boolean }>();
const emit = defineEmits<{ save: [value: AgentPresetDraft]; remove: [] }>();

const draft = reactive({ title: "", description: "", prompt: "", form: "" });

function adopt(preset: AgentPreset) {
  draft.title = preset.title;
  draft.description = preset.description ?? "";
  draft.prompt = preset.prompt;
  draft.form = preset.form ?? "";
}

watch(() => props.preset, adopt, { immediate: true });

function save() {
  emit("save", {
    title: draft.title,
    prompt: draft.prompt,
    ...(draft.description.trim() ? { description: draft.description } : {}),
    ...(draft.form.trim() ? { form: draft.form } : {}),
  });
}
</script>

<template>
  <UiCard as="section" appearance="frame" class="preset">
    <div class="head">
      <h4>{{ preset.title || "Без названия" }}</h4>
      <UiInline :gap="2">
        <UiButton appearance="solid" size="sm" :busy="busy" :disabled="busy" @click="save"
          >Сохранить</UiButton
        >
        <UiButton
          appearance="outline"
          tone="danger"
          size="sm"
          :disabled="busy"
          @click="emit('remove')"
          >Удалить</UiButton
        >
      </UiInline>
    </div>
    <UiField v-slot="{ control }" label="название">
      <UiControl
        v-bind="control"
        :value="draft.title"
        :disabled="busy"
        placeholder="Например: Ревью изменений"
        @input="draft.title = ($event.target as HTMLInputElement).value"
      />
    </UiField>
    <UiField v-slot="{ control }" label="описание">
      <UiControl
        v-bind="control"
        :value="draft.description"
        :disabled="busy"
        placeholder="Когда выбирать этот пресет"
        @input="draft.description = ($event.target as HTMLInputElement).value"
      />
    </UiField>
    <UiField
      v-slot="{ control }"
      label="текст запроса"
      hint="Этот текст агент получит после нажатия на пресет. Его можно оставить пустым, если есть форма."
    >
      <UiControl
        as="textarea"
        v-bind="control"
        :value="draft.prompt"
        :disabled="busy"
        rows="4"
        placeholder="Что должен сделать агент"
        @input="draft.prompt = ($event.target as HTMLTextAreaElement).value"
      />
    </UiField>
    <UiField
      v-slot="{ control }"
      label="форма"
      hint="Необязательная Vue-разметка с Form или IntelligentForm. Пользователь заполнит её на стартовом экране, а значения уйдут агенту вместе с текстом запроса."
    >
      <UiControl
        as="textarea"
        v-bind="control"
        :value="draft.form"
        :disabled="busy"
        rows="6"
        mono
        placeholder='<IntelligentForm summary="Настройки">…</IntelligentForm>'
        @input="draft.form = ($event.target as HTMLTextAreaElement).value"
      />
    </UiField>
  </UiCard>
</template>

<style scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  flex-wrap: wrap;
}
h4 {
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 500;
  overflow-wrap: anywhere;
}
</style>
