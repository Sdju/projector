<script setup lang="ts">
import UiHeading from "../../common/ui/UiHeading.vue";
import UiLabel from "../../common/ui/UiLabel.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import UiChoiceGroup from "../../common/ui/UiChoiceGroup.vue";
import UiChoiceRow from "../../common/ui/UiChoiceRow.vue";
import UiInline from "../../common/ui/UiInline.vue";

import { onMounted, ref, useId, computed } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import UiHint from "../../common/ui/UiHint.vue";
import {
  appearanceOptions,
  isAppearanceChoice,
  type AppearanceChoice,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  appearanceThemes,
  applyAppearance,
  currentAppearance,
  setAppearanceThemes,
} from "../appearance/index.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
const shortcutId = useId();
const appearanceId = useId();
const mode = ref("native");
const saved = ref("native");
const shortcut = ref("Ctrl+Alt+Space");
const savedShortcut = ref("Ctrl+Alt+Space");
const hotkey = ref<{ supported: boolean; active: boolean; shortcut: string }>();
const appearance = ref<AppearanceChoice>(currentAppearance());
const savedAppearance = ref<AppearanceChoice>(appearance.value);
const { ready, busy, error, status, load: loadLauncherSection, perform } = useSectionAction();
const appearanceState = useSectionAction();
const {
  busy: appearanceBusy,
  error: appearanceError,
  status: appearanceStatus,
  load: loadAppearanceSection,
  perform: performAppearance,
} = appearanceState;
appearanceBusy.value = true;
const availableAppearances = computed(() => [...appearanceOptions, ...appearanceThemes().value]);
const appearanceDescription = computed(
  () =>
    availableAppearances.value.find((option) => option.id === appearance.value)?.description ?? "",
);
const modes = [
  {
    id: "native",
    title: "Системное окно",
    description: "Нативное поле поиска и список приложений. По умолчанию.",
  },
  {
    id: "window",
    title: "Отдельное веб-окно",
    description: "Интерфейс Projector без вкладок и адресной строки.",
  },
  { id: "browser", title: "Страница в браузере", description: "Обычная вкладка в вашем браузере." },
];
async function request(method: string, body?: object) {
  const response = await fetch("/api/launcher/settings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
onMounted(() => {
  void loadAppearance();
  void loadLauncher();
});
async function loadLauncher() {
  await loadLauncherSection(async () => {
    const data = await request("GET");
    mode.value = saved.value = data.mode;
    shortcut.value = savedShortcut.value = data.shortcut;
    hotkey.value = data.hotkey;
  }, "Не удалось загрузить настройки");
}
async function loadAppearance() {
  await loadAppearanceSection(async () => {
    const response = await fetch("/api/appearance");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить схему");
    setAppearanceThemes(data.themes ?? []);
    if (isAppearanceChoice(data.choice)) appearance.value = data.choice;
    savedAppearance.value = appearance.value;
    applyAppearance(appearance.value);
  }, "Не удалось загрузить схему");
}
async function saveAppearance() {
  const next = appearance.value;
  if (next === savedAppearance.value) return;
  const previous = savedAppearance.value;
  applyAppearance(next);
  await performAppearance(
    async () => {
      const response = await fetch("/api/appearance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить схему");
      savedAppearance.value = next;
    },
    {
      errorFallback: "Не удалось сохранить схему",
      success: "Схема сохранена",
      rollback: () => {
        appearance.value = previous;
        applyAppearance(previous);
      },
    },
  );
}
async function save() {
  await perform(
    async () => {
      const data = await request("PUT", { mode: mode.value, shortcut: shortcut.value });
      saved.value = mode.value;
      savedShortcut.value = shortcut.value;
      hotkey.value = data.hotkey;
    },
    { errorFallback: "Не удалось сохранить", success: "Сохранено" },
  );
}
async function open() {
  await perform(
    async () => {
      const response = await fetch("/api/app/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: mode.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
    },
    { errorFallback: "Не удалось открыть" },
  );
}
</script>

<template>
  <section class="interface-settings">
    <UiHeading as="h2" size="sm">Как открывать Projector</UiHeading>
    <UiChoiceGroup v-slot="{ groupName }" label="Режим интерфейса" :disabled="!ready || busy">
      <UiChoiceRow
        v-for="option in modes"
        :key="option.id"
        :title="option.title"
        :description="option.description"
        ><UiControl v-model="mode" type="radio" :name="groupName" :value="option.id"
      /></UiChoiceRow>
    </UiChoiceGroup>
    <UiLabel size="sm" tone="secondary" :space-before="4" :space-after="2" :for="shortcutId"
      >Горячая клавиша</UiLabel
    >
    <UiControl as="select" :id="shortcutId" v-model="shortcut" :disabled="!ready || busy">
      <option value="Ctrl+Alt+Space">Ctrl + Alt + Space</option>
      <option value="Super+Space">Super + Space</option>
      <option value="Alt+Space">Alt + Space</option>
      <option value="">Выключена</option>
    </UiControl>
    <UiHint class="hint" role="status">
      <template v-if="!shortcut">Горячая клавиша выключена.</template>
      <template v-else-if="hotkey?.active"
        >Работает: {{ hotkey.shortcut }}. Projector остаётся в трее после закрытия поиска.</template
      >
      <template v-else-if="hotkey?.supported"
        >Горячая клавиша пока не активна. Сохраните настройки или запустите Projector.</template
      >
      <template v-else
        >В этом окружении назначьте системный хоткей на команду
        <code>projector toggle</code>.</template
      >
    </UiHint>
    <UiInline class="actions" align="stretch" wrap>
      <UiButton
        appearance="solid"
        :disabled="!ready || busy || (saved === mode && savedShortcut === shortcut)"
        @click="save"
      >
        Сохранить
      </UiButton>
      <UiButton :disabled="!ready || busy" @click="open">Открыть выбранный режим</UiButton>
    </UiInline>
    <details>
      <summary>Системный хоткей и трей</summary>
      <UiHint class="hint">
        Сочетание регистрируется в KDE или Windows; занятые клавиши не перехватываются. Клик по
        иконке в трее открывает поиск, меню даёт доступ к настройкам, перезапуску и выходу.
      </UiHint>
    </details>
    <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">{{
      error || status
    }}</UiMessage>
    <UiHeading as="h2" size="sm" :space-before="4">Оформление</UiHeading>
    <UiLabel :for="appearanceId" :space-after="2">Цветовая схема</UiLabel>
    <UiControl
      as="select"
      :id="appearanceId"
      v-model="appearance"
      :disabled="appearanceBusy"
      @change="saveAppearance"
    >
      <option v-for="option in availableAppearances" :key="option.id" :value="option.id">
        {{ option.title }}
      </option>
    </UiControl>
    <UiHint class="hint">{{ appearanceDescription }} Схема применяется сразу и сохраняется.</UiHint>
    <UiMessage
      v-if="appearanceError || appearanceStatus"
      role="status"
      :tone="appearanceError ? 'danger' : undefined"
      >{{ appearanceError || appearanceStatus }}</UiMessage
    >
  </section>
</template>

<style scoped>
.interface-settings {
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.actions {
  margin-top: var(--sp-4);
}
.hint {
  margin-top: var(--sp-4);
  font-size: var(--fs-xs);
}
select {
  max-width: 320px;
}
details {
  margin-top: var(--sp-4);
  font-size: var(--fs-xs);
  color: var(--muted);
}
summary {
  cursor: pointer;
}
</style>
