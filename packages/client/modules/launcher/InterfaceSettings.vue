<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";

import { onMounted, ref, useId, computed } from "vue";
import UiButton from "../../common/ui/UiButton.vue";
import {
  appearanceOptions,
  isAppearanceChoice,
  type AppearanceChoice,
} from "@ai-projector/core/modules/appearance/index.ts";
import {
  appearanceThemes,
  currentAppearance,
  setGlobalAppearanceChoice,
  setGlobalAppearanceFonts,
  setGlobalAppearanceSettings,
  useAppearanceFontSettings,
  ThemeSettingsHost,
} from "../appearance/index.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
import { rightPanelPreference, saveRightPanelPreference } from "../workspace/index.ts";
const shortcutId = useId();
const chatSizeId = useId();
const terminalSizeId = useId();
const {
  draft: fontDraft,
  ready: fontsReady,
  busy: fontsBusy,
  error: fontsError,
  status: fontsStatus,
  min: fontMin,
  max: fontMax,
  preview: previewFont,
  commit: commitFont,
} = useAppearanceFontSettings(["chat", "terminal"]);
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
  () => availableAppearances.value.find(({ id }) => id === appearance.value)?.description ?? "",
);
const launcherDirty = computed(
  () => saved.value !== mode.value || savedShortcut.value !== shortcut.value,
);
const modes = [
  {
    id: "native",
    title: "Системное окно",
    description: "Быстрый поиск поверх других приложений.",
    icon: "monitor",
  },
  {
    id: "window",
    title: "Отдельное окно",
    description: "Projector без элементов браузера.",
    icon: "app-window",
  },
  {
    id: "browser",
    title: "В браузере",
    description: "Обычная вкладка с привычной навигацией.",
    icon: "globe-2",
  },
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
    rightPanelPreference.value = data.rightPanel === true;
  }, "Не удалось загрузить настройки");
}
const rightPanelBusy = ref(false);
const rightPanelStatus = ref("");
const rightPanelError = ref("");
async function setRightPanel(enabled: boolean) {
  if (rightPanelBusy.value) return;
  const previous = rightPanelPreference.value;
  rightPanelPreference.value = enabled;
  rightPanelBusy.value = true;
  rightPanelError.value = "";
  rightPanelStatus.value = "";
  try {
    rightPanelPreference.value = await saveRightPanelPreference(enabled);
    rightPanelStatus.value = enabled
      ? "Правая панель включена для всех проектов"
      : "Правая панель выключена";
  } catch (error) {
    rightPanelPreference.value = previous;
    rightPanelError.value = error instanceof Error ? error.message : "Не удалось сохранить";
  } finally {
    rightPanelBusy.value = false;
  }
}
async function loadAppearance() {
  await loadAppearanceSection(async () => {
    const response = await fetch("/api/appearance");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить схему");
    if (isAppearanceChoice(data.choice)) appearance.value = data.choice;
    savedAppearance.value = appearance.value;
    setGlobalAppearanceSettings(data);
  }, "Не удалось загрузить схему");
}
async function saveAppearance() {
  const next = appearance.value;
  if (next === savedAppearance.value) return;
  const previous = savedAppearance.value;
  setGlobalAppearanceChoice(next);
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
      if (data.fonts) setGlobalAppearanceFonts(data.fonts);
    },
    {
      errorFallback: "Не удалось сохранить схему",
      success: "Схема сохранена",
      rollback: () => {
        appearance.value = previous;
        setGlobalAppearanceChoice(previous);
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
    { errorFallback: "Не удалось сохранить", success: "Настройки запуска сохранены" },
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
function fontProgress(key: "chat" | "terminal") {
  return `${((fontDraft.value[key] - fontMin) / (fontMax - fontMin)) * 100}%`;
}
</script>

<template>
  <section class="interface-settings">
    <section class="settings-group" aria-labelledby="launch-settings-title">
      <header class="group-heading">
        <span class="group-icon"><ProjectorIcon name="monitor" aria-hidden="true" /></span>
        <div>
          <h2 id="launch-settings-title">Запуск и окно</h2>
          <p>Выберите, как Projector будет открываться на этом компьютере.</p>
        </div>
      </header>

      <fieldset class="mode-grid" :disabled="!ready || busy">
        <legend class="visually-hidden">Режим интерфейса</legend>
        <label v-for="option in modes" :key="option.id" class="mode-card">
          <UiControl v-model="mode" type="radio" name="interface-mode" :value="option.id" />
          <span class="mode-preview" :class="`mode-preview-${option.id}`" aria-hidden="true">
            <span class="preview-top"><i /><i /><i /></span>
            <span class="preview-body"><ProjectorIcon :name="option.icon" /><i /><i /></span>
          </span>
          <span class="mode-copy">
            <strong>{{ option.title }}</strong>
            <small>{{ option.description }}</small>
          </span>
          <span class="selection-mark"><ProjectorIcon name="check" aria-hidden="true" /></span>
        </label>
      </fieldset>

      <div class="launch-controls">
        <div class="shortcut-control">
          <label :for="shortcutId"
            ><ProjectorIcon name="keyboard" aria-hidden="true" />Горячая клавиша</label
          >
          <span class="select-wrap">
            <UiControl as="select" :id="shortcutId" v-model="shortcut" :disabled="!ready || busy">
              <option value="Ctrl+Alt+Space">Ctrl + Alt + Space</option>
              <option value="Super+Space">Super + Space</option>
              <option value="Alt+Space">Alt + Space</option>
              <option value="">Не использовать</option>
            </UiControl>
            <ProjectorIcon name="chevron-down" aria-hidden="true" />
          </span>
          <small class="control-hint" :class="{ active: shortcut && hotkey?.active }" role="status">
            <span class="status-dot" />
            <template v-if="!shortcut"
              >Вызов только из меню или командой projector toggle.</template
            >
            <template v-else-if="hotkey?.active">Активна · {{ hotkey.shortcut }}</template>
            <template v-else-if="hotkey?.supported">Применится после сохранения.</template>
            <template v-else>Назначьте системный хоткей на projector toggle.</template>
          </small>
        </div>
        <div class="launch-actions">
          <UiButton :disabled="!ready || busy" @click="open"
            ><ProjectorIcon name="play" />Открыть</UiButton
          >
          <UiButton appearance="solid" :disabled="!ready || busy || !launcherDirty" @click="save">
            {{ busy ? "Сохранение…" : launcherDirty ? "Применить" : "Применено" }}
          </UiButton>
        </div>
      </div>
      <UiMessage v-if="error || status" role="status" :tone="error ? 'danger' : undefined">
        {{ error || status }}
      </UiMessage>

      <div class="panel-setting">
        <span class="setting-icon"><ProjectorIcon name="panel-right" aria-hidden="true" /></span>
        <div class="setting-copy">
          <label :for="`${shortcutId}-right-panel`">Панель терминалов справа</label>
          <p>Отдельное место для терминалов во всех проектах.</p>
        </div>
        <label class="switch">
          <UiControl
            :id="`${shortcutId}-right-panel`"
            type="checkbox"
            :model-value="rightPanelPreference"
            :disabled="!ready || rightPanelBusy"
            @update:model-value="setRightPanel(!!$event)"
          />
          <span aria-hidden="true" />
          <span class="visually-hidden">Правая панель с терминалами</span>
        </label>
      </div>
      <UiMessage
        v-if="rightPanelError || rightPanelStatus"
        role="status"
        :tone="rightPanelError ? 'danger' : undefined"
        >{{ rightPanelError || rightPanelStatus }}</UiMessage
      >
    </section>

    <section class="settings-group" aria-labelledby="appearance-settings-title">
      <header class="group-heading">
        <span class="group-icon"><ProjectorIcon name="palette" aria-hidden="true" /></span>
        <div>
          <h2 id="appearance-settings-title">Оформление</h2>
          <p>Цвета применяются сразу — можно сравнить варианты без сохранения отдельной кнопкой.</p>
        </div>
      </header>

      <fieldset class="theme-grid" :disabled="appearanceBusy">
        <legend class="visually-hidden">Цветовая схема</legend>
        <label v-for="option in availableAppearances" :key="option.id" class="theme-card">
          <UiControl
            v-model="appearance"
            type="radio"
            name="color-scheme"
            :value="option.id"
            @change="saveAppearance"
          />
          <span class="theme-preview" :class="`theme-${option.id}`" aria-hidden="true">
            <span class="theme-sidebar"><i /><i /><i /></span>
            <span class="theme-content"><i /><i /><b /></span>
            <ProjectorIcon name="check" class="theme-check" />
          </span>
          <strong>{{ option.title }}</strong>
        </label>
      </fieldset>
      <p class="appearance-description">{{ appearanceDescription }}</p>
      <div class="appearance-sample" aria-label="Пример оформления">
        <div class="sample-toolbar">
          <span>Пример интерфейса</span>
          <span class="sample-status"><i />Все системы работают</span>
        </div>
        <div class="sample-body">
          <div class="sample-message">
            <span class="sample-avatar">P</span>
            <div>
              <strong>Projector</strong>
              <p>Настройки применены. Так выглядят основной текст, ссылки и код.</p>
              <a href="#appearance-settings-title" @click.prevent>Открыть документацию</a>
            </div>
          </div>
          <pre
            class="sample-code"
          ><code><span class="syntax-keyword">const</span> <span class="syntax-function">theme</span> = {
  name: <span class="syntax-string">"{{ appearance }}"</span>,
  contrast: <span class="syntax-number">4.5</span>, <span class="syntax-comment">// читаемость прежде всего</span>
};</code></pre>
        </div>
      </div>
      <ThemeSettingsHost :key="appearance" :theme="appearance" :disabled="appearanceBusy" />
      <UiMessage
        v-if="appearanceError || appearanceStatus"
        role="status"
        :tone="appearanceError ? 'danger' : undefined"
        >{{ appearanceError || appearanceStatus }}</UiMessage
      >
    </section>

    <section class="settings-group" aria-labelledby="font-settings-title">
      <header class="group-heading">
        <span class="group-icon"><ProjectorIcon name="type" aria-hidden="true" /></span>
        <div>
          <h2 id="font-settings-title">Размер текста</h2>
          <p>Настройте читаемость содержимого, не меняя масштаб самого интерфейса.</p>
        </div>
      </header>

      <div class="font-grid">
        <div class="font-card">
          <div class="font-card-heading">
            <span class="font-preview"
              ><ProjectorIcon name="message-square" aria-hidden="true" />Aa</span
            >
            <label :for="chatSizeId">Чат агента</label>
            <UiControl
              class="font-number"
              type="number"
              aria-label="Размер текста чата в пикселях"
              :min="fontMin"
              :max="fontMax"
              :step="1"
              :model-value="fontDraft.chat"
              :disabled="!fontsReady || fontsBusy"
              @update:model-value="previewFont('chat', Number($event))"
              @change="commitFont('chat')"
            />
            <span class="font-unit">px</span>
          </div>
          <UiControl
            :id="chatSizeId"
            class="font-range"
            type="range"
            :min="fontMin"
            :max="fontMax"
            :step="1"
            :model-value="fontDraft.chat"
            :disabled="!fontsReady || fontsBusy"
            :style="{ '--range-progress': fontProgress('chat') }"
            @update:model-value="previewFont('chat', Number($event))"
            @change="commitFont('chat')"
          />
          <div class="range-labels"><span>{{ fontMin }}</span><span>{{ fontMax }}</span></div>
          <div class="font-output chat-output" :style="{ fontSize: `${fontDraft.chat}px` }">
            <span class="output-label">Пример ответа</span>
            <p>Готово! Настройки интерфейса сохранены.</p>
            <p class="output-secondary">Текст должен легко читаться на привычном расстоянии.</p>
          </div>
        </div>

        <div class="font-card">
          <div class="font-card-heading">
            <span class="font-preview terminal-preview"
              ><ProjectorIcon name="terminal" aria-hidden="true" />&gt;_</span
            >
            <label :for="terminalSizeId">Терминал</label>
            <UiControl
              class="font-number"
              type="number"
              aria-label="Размер текста терминала в пикселях"
              :min="fontMin"
              :max="fontMax"
              :step="1"
              :model-value="fontDraft.terminal"
              :disabled="!fontsReady || fontsBusy"
              @update:model-value="previewFont('terminal', Number($event))"
              @change="commitFont('terminal')"
            />
            <span class="font-unit">px</span>
          </div>
          <UiControl
            :id="terminalSizeId"
            class="font-range"
            type="range"
            :min="fontMin"
            :max="fontMax"
            :step="1"
            :model-value="fontDraft.terminal"
            :disabled="!fontsReady || fontsBusy"
            :style="{ '--range-progress': fontProgress('terminal') }"
            @update:model-value="previewFont('terminal', Number($event))"
            @change="commitFont('terminal')"
          />
          <div class="range-labels"><span>{{ fontMin }}</span><span>{{ fontMax }}</span></div>
          <div class="font-output terminal-output" :style="{ fontSize: `${fontDraft.terminal}px` }">
            <span class="output-label">Пример вывода</span>
            <p><span class="terminal-prompt">~/projector</span> vp test related</p>
            <p class="terminal-success">✓ 13 tests passed</p>
          </div>
        </div>
      </div>
      <UiMessage
        v-if="fontsError || fontsStatus"
        role="status"
        :tone="fontsError ? 'danger' : undefined"
        >{{ fontsError || fontsStatus }}</UiMessage
      >
    </section>
  </section>
</template>

<style scoped>
.interface-settings {
  display: grid;
  gap: var(--sp-4);
  margin-bottom: var(--ui-section-margin, var(--sp-6));
}
.settings-group {
  min-width: 0;
  padding: var(--sp-4);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
}
.group-heading {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.group-heading h2 {
  margin: 0 0 var(--sp-1);
  font-size: var(--fs-md);
  font-weight: 600;
}
.group-heading p,
.setting-copy p {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.group-icon,
.setting-icon {
  display: grid;
  place-items: center;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg-3);
  color: var(--text-2);
}
.group-icon svg,
.setting-icon svg {
  width: 16px;
  height: 16px;
}
fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--sp-2);
}
.mode-card,
.theme-card {
  position: relative;
  cursor: pointer;
  color: var(--text);
}
.mode-card > input,
.theme-card > input,
.switch > input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.mode-card {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  transition:
    border-color var(--t-fast),
    background var(--t-fast),
    transform var(--t-fast);
}
.mode-card:hover {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.mode-card:has(input:checked),
.theme-card:has(input:checked) .theme-preview {
  border-color: var(--focus);
  background: color-mix(in srgb, var(--selection) 60%, var(--bg));
}
.mode-card:has(input:focus-visible),
.theme-card:has(input:focus-visible) .theme-preview,
.switch:has(input:focus-visible) > span:not(.visually-hidden) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.mode-card:has(input:disabled),
.theme-card:has(input:disabled) {
  cursor: wait;
  opacity: 0.6;
}
.mode-preview {
  display: grid;
  grid-template-rows: 10px 1fr;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
}
.preview-top {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 0 var(--sp-1);
  border-bottom: 1px solid var(--line);
}
.preview-top i {
  width: 3px;
  height: 3px;
  border-radius: var(--r-full);
  background: var(--faint);
}
.preview-body {
  display: grid;
  place-content: center;
  gap: var(--sp-1);
  color: var(--muted);
}
.preview-body svg {
  width: 20px;
  height: 20px;
  margin: auto;
}
.preview-body i {
  display: block;
  width: 48px;
  height: 3px;
  border-radius: var(--r-full);
  background: var(--line-strong);
}
.preview-body i:last-child {
  width: 32px;
}
.mode-preview-native {
  border-color: transparent;
  background: transparent;
}
.mode-preview-native .preview-top {
  justify-content: center;
  border: 1px solid var(--line);
  border-bottom: 0;
  border-radius: var(--r-sm) var(--r-sm) 0 0;
}
.mode-preview-native .preview-top i {
  display: none;
}
.mode-preview-native .preview-body {
  border: 1px solid var(--line);
  border-radius: 0 0 var(--r-sm) var(--r-sm);
}
.mode-copy {
  display: grid;
  gap: var(--sp-1);
  padding: 0 var(--sp-1) var(--sp-1);
}
.mode-copy strong,
.theme-card strong {
  font-size: var(--fs-xs);
  font-weight: 600;
}
.mode-copy small {
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: var(--lh);
}
.selection-mark {
  position: absolute;
  top: var(--sp-3);
  right: var(--sp-3);
  display: none;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: var(--r-full);
  background: var(--focus);
  color: var(--bg);
}
.selection-mark svg {
  width: 12px;
  height: 12px;
}
.mode-card:has(input:checked) .selection-mark {
  display: grid;
}
.launch-controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--sp-4);
  margin-top: var(--sp-4);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--line);
}
.shortcut-control {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
.shortcut-control > label {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  font-size: var(--fs-xs);
  font-weight: 500;
}
.shortcut-control > label svg {
  width: 14px;
  height: 14px;
  color: var(--muted);
}
.select-wrap {
  position: relative;
  display: block;
  width: 230px;
  max-width: 100%;
}
.select-wrap select {
  width: 100%;
  min-height: 36px;
  padding: var(--sp-2) var(--sp-5) var(--sp-2) var(--sp-3);
  appearance: none;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
}
.select-wrap > svg {
  position: absolute;
  top: 50%;
  right: var(--sp-3);
  width: 14px;
  height: 14px;
  transform: translateY(-50%);
  color: var(--muted);
  pointer-events: none;
}
.control-hint {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.status-dot {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--faint);
}
.control-hint.active .status-dot {
  background: var(--run);
}
.launch-actions {
  display: flex;
  flex-shrink: 0;
  gap: var(--sp-2);
}
.launch-actions button svg {
  width: 13px;
  height: 13px;
}
.panel-setting {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-top: var(--sp-4);
  padding: var(--sp-3);
  border-radius: var(--r-md);
  background: var(--bg);
}
.setting-copy {
  flex: 1;
  min-width: 0;
}
.setting-copy label {
  font-size: var(--fs-xs);
  font-weight: 500;
  cursor: pointer;
}
.switch {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 22px;
  cursor: pointer;
}
.switch > span:not(.visually-hidden) {
  position: absolute;
  inset: 0;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-full);
  background: var(--bg-3);
  transition:
    background var(--t-fast),
    border-color var(--t-fast);
}
.switch > span:not(.visually-hidden)::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: var(--r-full);
  background: var(--muted);
  transition:
    transform var(--t-fast),
    background var(--t-fast);
}
.switch:has(input:checked) > span:not(.visually-hidden) {
  border-color: var(--focus);
  background: var(--focus);
}
.switch:has(input:checked) > span:not(.visually-hidden)::after {
  transform: translateX(16px);
  background: var(--bg);
}
.theme-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--sp-2);
}
.theme-card {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
.theme-card strong {
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.theme-preview {
  position: relative;
  display: grid;
  grid-template-columns: 24% 1fr;
  height: 76px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  transition:
    border-color var(--t-fast),
    transform var(--t-fast);
}
.theme-card:hover .theme-preview {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.theme-sidebar {
  display: grid;
  align-content: start;
  gap: var(--sp-1);
  padding: var(--sp-2) var(--sp-1);
  border-right: 1px solid var(--line);
  background: var(--bg-2);
}
.theme-sidebar i {
  height: 3px;
  border-radius: var(--r-full);
  background: var(--line-strong);
}
.theme-content {
  display: grid;
  align-content: center;
  gap: var(--sp-2);
  padding: var(--sp-2);
}
.theme-content i {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--text-2);
}
.theme-content i:nth-child(2) {
  width: 65%;
  background: var(--muted);
}
.theme-content b {
  width: 45%;
  height: 12px;
  border-radius: var(--r-sm);
  background: var(--selection);
}
.theme-check {
  position: absolute;
  right: var(--sp-1);
  bottom: var(--sp-1);
  display: none;
  width: 14px;
  height: 14px;
  padding: 2px;
  border-radius: var(--r-full);
  background: var(--focus);
  color: var(--bg);
}
.theme-card:has(input:checked) .theme-check {
  display: block;
}
.theme-dark {
  --bg: #10100f;
  --bg-2: #20201c;
  --line: #46463f;
  --line-strong: #5d5d55;
  --text: #ecece6;
  --text-2: #c9c9bf;
  --muted: #92928b;
  --focus: #d8d2c4;
  --selection: #5c553b;
}
.theme-light {
  --bg: #f7f6f1;
  --bg-2: #e5e3db;
  --line: #d9d6cc;
  --line-strong: #b6b2a6;
  --text: #1d1d1a;
  --text-2: #51514a;
  --muted: #92928b;
  --focus: #6d5f2c;
  --selection: #cfcabc;
}
.theme-contrast {
  --bg: #000;
  --bg-2: #121212;
  --line: #7a7a7a;
  --line-strong: #a8a8a8;
  --text: #fff;
  --text-2: #ededed;
  --muted: #c2c2c2;
  --focus: #ffd45c;
  --selection: #5c4a1e;
}
.theme-frozen-glass {
  --bg: #101e2f;
  --bg-2: #20374e;
  --line: #527caa;
  --line-strong: #a1d8ff;
  --text: #eef8ff;
  --text-2: #bfd7e9;
  --muted: #7fb0d6;
  --focus: #b4edff;
  --selection: #315675;
}
.theme-auto {
  background: linear-gradient(110deg, #f7f6f1 0 49%, #10100f 51% 100%);
}
.theme-auto .theme-sidebar {
  background: #e5e3db;
}
.theme-auto .theme-content i:first-child {
  background: #ecece6;
}
.appearance-description {
  min-height: 1.45em;
  margin: var(--sp-3) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.appearance-sample {
  margin: var(--sp-3) 0 var(--sp-4);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background:
    var(--theme-wallpaper-overlay, linear-gradient(transparent, transparent)),
    var(--theme-wallpaper, none) center / cover no-repeat,
    var(--theme-wallpaper-fallback, none),
    var(--bg);
  color: var(--text);
}
.sample-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
  background: var(--theme-chrome, var(--bg-2));
  backdrop-filter: var(--theme-backdrop, none);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.sample-status {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--run);
}
.sample-status i {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--run);
}
.sample-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--sp-4);
  padding: var(--sp-4);
  background: var(--theme-surface, transparent);
  backdrop-filter: var(--theme-backdrop, none);
}
.sample-message {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
  min-width: 0;
}
.sample-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  border-radius: var(--r-md);
  background: var(--selection);
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.sample-message strong {
  font-size: var(--fs-xs);
  font-weight: 600;
}
.sample-message p {
  margin: var(--sp-1) 0;
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.sample-message a {
  color: var(--info);
  font-size: var(--fs-xs);
  text-decoration: none;
}
.sample-message a:hover {
  text-decoration: underline;
}
.sample-code {
  min-width: 0;
  margin: 0;
  padding: var(--sp-3);
  overflow-x: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--theme-inset-background, var(--bg-sunken));
  color: var(--text-2);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.syntax-keyword {
  color: var(--syntax-keyword);
}
.syntax-function {
  color: var(--syntax-function);
}
.syntax-string {
  color: var(--syntax-string);
}
.syntax-number {
  color: var(--syntax-number);
}
.syntax-comment {
  color: var(--syntax-comment);
}
.font-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--sp-3);
}
.font-card {
  min-width: 0;
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
}
.font-card-heading {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  margin-bottom: var(--sp-4);
}
.font-card-heading > label {
  flex: 1;
  font-size: var(--fs-xs);
  font-weight: 500;
}
.font-preview {
  display: flex;
  align-items: center;
  gap: var(--sp-1);
  color: var(--text-2);
  font-size: var(--fs-md);
}
.font-preview svg {
  width: 16px;
  height: 16px;
  color: var(--muted);
}
.terminal-preview {
  font-family: var(--mono);
  font-size: var(--fs-sm);
}
.font-number {
  width: 54px;
  min-height: 30px;
  padding: var(--sp-1) var(--sp-2);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text);
  text-align: center;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.font-unit {
  margin-left: calc(var(--sp-1) * -1);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.font-range {
  --range-progress: 22%;
  width: 100%;
  height: 20px;
  margin: 0;
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.font-range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: var(--r-full);
  background: linear-gradient(
    to right,
    var(--focus) var(--range-progress),
    var(--bg-4) var(--range-progress)
  );
}
.font-range::-moz-range-track {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--bg-4);
}
.font-range::-moz-range-progress {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--focus);
}
.font-range::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -6px;
  appearance: none;
  border: 3px solid var(--bg);
  border-radius: var(--r-full);
  background: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
  transition: transform var(--t-fast);
}
.font-range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 3px solid var(--bg);
  border-radius: var(--r-full);
  background: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.font-range:hover::-webkit-slider-thumb {
  transform: scale(1.15);
}
.range-labels {
  display: flex;
  justify-content: space-between;
  color: var(--faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
}
.font-output {
  min-height: 116px;
  margin-top: var(--sp-3);
  padding: var(--sp-3);
  border-top: 1px solid var(--line);
  background: var(--bg-2);
  color: var(--text);
  line-height: var(--lh);
}
.font-output p {
  margin: var(--sp-2) 0 0;
  overflow-wrap: anywhere;
}
.output-label {
  display: block;
  color: var(--faint);
  font-family: var(--sans);
  font-size: var(--fs-2xs);
  line-height: var(--lh);
}
.output-secondary {
  color: var(--muted);
}
.terminal-output {
  font-family: var(--mono);
}
.terminal-prompt {
  color: var(--info);
}
.terminal-success {
  color: var(--run);
}
@media (max-width: 680px) {
  .mode-grid {
    grid-template-columns: 1fr;
  }
  .mode-card {
    grid-template-columns: 88px 1fr;
    align-items: center;
  }
  .mode-preview {
    height: 60px;
  }
  .theme-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .launch-controls {
    align-items: stretch;
    flex-direction: column;
  }
  .select-wrap {
    width: 100%;
  }
  .launch-actions {
    justify-content: flex-end;
  }
  .sample-body {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 460px) {
  .settings-group {
    padding: var(--sp-3);
  }
  .theme-grid,
  .font-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .font-card-heading {
    flex-wrap: wrap;
  }
  .font-card-heading > label {
    min-width: 70px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .mode-card,
  .theme-preview,
  .switch > span,
  .switch > span::after,
  .font-range::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
