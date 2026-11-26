<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import InterfaceSettingsGroup from "./InterfaceSettingsGroup.vue";
import { computed, onMounted, ref } from "vue";
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
  ThemeSettingsHost,
} from "../appearance/index.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
const appearance = ref<AppearanceChoice>(currentAppearance());
const savedAppearance = ref<AppearanceChoice>(appearance.value);
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
onMounted(() => void loadAppearance());
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
</script>

<template>
  <InterfaceSettingsGroup
    icon="palette"
    title="Оформление"
    description="Цвета применяются сразу — можно сравнить варианты без сохранения отдельной кнопкой."
  >
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
            <a href="#" @click.prevent>Открыть документацию</a>
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
  </InterfaceSettingsGroup>
</template>

<style scoped>
.theme-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: var(--sp-2);
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
.theme-card {
  position: relative;
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  cursor: pointer;
  color: var(--text);
}
.theme-card > input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.theme-card:has(input:checked) .theme-preview {
  border-color: var(--focus);
  background: color-mix(in srgb, var(--selection) 60%, var(--bg));
}
.theme-card:has(input:focus-visible) .theme-preview {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.theme-card:has(input:disabled) {
  cursor: wait;
  opacity: 0.6;
}
.theme-card strong {
  font-size: var(--fs-xs);
  font-weight: 600;
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
@media (max-width: 680px) {
  .theme-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .sample-body {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 460px) {
  .theme-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (prefers-reduced-motion: reduce) {
  .theme-preview {
    transition: none;
  }
}
</style>
