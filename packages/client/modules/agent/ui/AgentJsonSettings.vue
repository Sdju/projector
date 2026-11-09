<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiField from "../../../common/ui/UiField.vue";
import UiSettingsSection from "../../../common/ui/UiSettingsSection.vue";

/** JSON file editor shared by agent settings: MCP servers, hooks and similar user files. */
const props = defineProps<{
  label: string;
  "aria-label": string;
  placeholder: string;
  text: string;
  draft?: string;
  busy: boolean;
  error?: string;
  activate: () => void;
}>();
const emit = defineEmits<{ "update:draft": [value: string]; save: [] }>();
</script>

<template>
  <UiSettingsSection :activate="activate" :error="error">
    <UiField v-slot="{ control }" :label="label">
      <UiControl
        v-bind="control"
        as="textarea"
        rows="10"
        :aria-label="props['aria-label']"
        spellcheck="false"
        :placeholder="placeholder"
        :value="draft ?? text"
        :disabled="busy"
        @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
      />
    </UiField>
    <UiButton appearance="solid" :disabled="busy || draft === undefined" @click="emit('save')"
      >Сохранить</UiButton
    >
    <slot name="summary" />
    <slot name="help" />
  </UiSettingsSection>
</template>
