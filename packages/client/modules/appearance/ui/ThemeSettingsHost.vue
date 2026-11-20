<script setup lang="ts">
import { computed, ref, useId, watch, watchEffect } from "vue";
import { builtinAppearance } from "@ai-projector/core/modules/appearance/index.ts";
import { resolveThemeValues, type ThemeValues } from "@ai-projector/core/modules/plugins/index.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { useSectionAction } from "../../../common/utilities/use-section-action.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { mountThemeSettings, runtimeThemeSettings } from "../../plugin-runtime/index.ts";
import { appearanceThemes, saveThemeSettings, themeSettingsValues } from "../appearance.ts";
import DeclaredThemeSettings from "./DeclaredThemeSettings.vue";
import { builtinThemeWidgets } from "./builtin-theme-widgets.ts";

const props = defineProps<{ theme: string; disabled: boolean }>();
const fields = computed(
  () =>
    (
      builtinAppearance(props.theme) ??
      appearanceThemes().value.find(({ id }) => id === props.theme)
    )?.settings ?? [],
);
const widget = computed(() => builtinThemeWidgets.get(props.theme));
const pluginWidget = computed(() =>
  runtimeThemeSettings.value.find(({ id }) => id === props.theme),
);
const pluginRoot = ref<HTMLElement>();
const mountError = ref("");
const stored = computed(() => themeSettingsValues.value[props.theme]);
const saved = computed(() => resolveThemeValues(fields.value, stored.value));
const draft = ref<ThemeValues>({});
watch(
  saved,
  (values) => {
    draft.value = { ...values };
  },
  { immediate: true },
);
const patch = computed(() =>
  Object.fromEntries(
    Object.entries(draft.value).filter(([id, value]) => value !== saved.value[id]),
  ),
);

const { busy, error, status, perform } = useSectionAction();
const disabled = computed(() => props.disabled || busy.value);
const command = "ide.appearance.theme.settings.set";
const { scope } = useCommandScope(`appearance-theme:${useId()}`, () => ({
  surface: "settings",
  theme: props.theme,
}));
scope.registerCommand({
  id: command,
  title: "Сохранить настройки цветовой схемы",
  description: "Сохраняет настройки темы по ID полей, объявленных в GET /api/appearance.",
  palette: false,
  arguments: { theme: "string: ID цветовой схемы", values: "object: значения по ID полей" },
  run: (args) => {
    const { theme, values } = commandArgs(args);
    if (typeof theme !== "string" || values === undefined)
      throw new Error("Укажите тему и её настройки");
    return saveThemeSettings(theme, values);
  },
});

function save(values: ThemeValues) {
  return perform(() => scope.executeCommand<ThemeValues>(command, { theme: props.theme, values }), {
    errorFallback: "Не удалось сохранить настройки схемы",
    success: "Настройки схемы сохранены",
  });
}
function submit() {
  if (!disabled.value && Object.keys(patch.value).length) void save(patch.value);
}

watchEffect(
  (onCleanup) => {
    const entry = pluginWidget.value;
    const element = pluginRoot.value;
    mountError.value = "";
    if (!entry || !element) return;
    const controller = new AbortController();
    const dispose = mountThemeSettings(
      entry,
      element,
      {
        signal: controller.signal,
        getValues: () => ({ ...saved.value }),
        async save(values) {
          if (controller.signal.aborted || disabled.value)
            throw new Error("Настройки схемы недоступны");
          const result = await save(values);
          if (!result) throw new Error(error.value || "Не удалось сохранить настройки схемы");
          return { ...result };
        },
      },
      (message) => {
        mountError.value = message;
      },
    );
    onCleanup(() => {
      controller.abort();
      dispose();
      element.replaceChildren();
    });
  },
  { flush: "post" },
);
</script>

<template>
  <template v-if="fields.length">
    <div v-if="pluginWidget" :key="pluginWidget.instance" ref="pluginRoot" />
    <template v-else>
      <component
        :is="widget ?? DeclaredThemeSettings"
        v-model="draft"
        v-bind="widget ? {} : { fields }"
        :disabled="disabled"
        @submit="submit"
      />
      <div class="actions">
        <UiButton :disabled="disabled || !Object.keys(patch).length" @click="submit">
          Применить настройки схемы
        </UiButton>
      </div>
    </template>
    <UiMessage
      v-if="mountError || error || status"
      role="status"
      :tone="mountError || error ? 'danger' : undefined"
    >
      {{ mountError || error || status }}
    </UiMessage>
  </template>
</template>

<style scoped>
.actions {
  margin-top: var(--sp-4);
}
</style>
