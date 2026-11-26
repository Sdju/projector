<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import { computed, onMounted, ref, useId } from "vue";
import InterfaceSettingsGroup from "./InterfaceSettingsGroup.vue";
import LauncherModePicker from "./LauncherModePicker.vue";
import UiButton from "../../common/ui/UiButton.vue";
import { rightPanelPreference, saveRightPanelPreference } from "../workspace/index.ts";
import { useSectionAction } from "../../common/utilities/use-section-action.ts";
const shortcutId = useId();
const mode = ref("native");
const saved = ref("native");
const shortcut = ref("Ctrl+Alt+Space");
const savedShortcut = ref("Ctrl+Alt+Space");
const hotkey = ref<{ supported: boolean; active: boolean; shortcut: string }>();
const { ready, busy, error, status, load: loadLauncherSection, perform } = useSectionAction();
const launcherDirty = computed(
  () => saved.value !== mode.value || savedShortcut.value !== shortcut.value,
);
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
onMounted(() => void loadLauncher());
async function loadLauncher() {
  await loadLauncherSection(async () => {
    const data = await request("GET");
    mode.value = saved.value = data.mode;
    shortcut.value = savedShortcut.value = data.shortcut;
    hotkey.value = data.hotkey;
    rightPanelPreference.value = data.rightPanel === true;
  }, "Не удалось загрузить настройки");
}
const {
  busy: rightPanelBusy,
  status: rightPanelStatus,
  error: rightPanelError,
  perform: performRightPanel,
} = useSectionAction();
async function setRightPanel(enabled: boolean) {
  const previous = rightPanelPreference.value;
  rightPanelPreference.value = enabled;
  await performRightPanel(
    async () => {
      rightPanelPreference.value = await saveRightPanelPreference(enabled);
    },
    {
      errorFallback: "Не удалось сохранить",
      success: enabled ? "Правая панель включена для всех проектов" : "Правая панель выключена",
      rollback: () => {
        rightPanelPreference.value = previous;
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
</script>

<template>
  <InterfaceSettingsGroup
    icon="monitor"
    title="Запуск и окно"
    description="Выберите, как Projector будет открываться на этом компьютере."
  >
    <LauncherModePicker v-model="mode" :disabled="!ready || busy" />

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
          <template v-if="!shortcut">Вызов только из меню или командой projector toggle.</template>
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
  </InterfaceSettingsGroup>
</template>

<style scoped>
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
.setting-icon svg {
  width: 16px;
  height: 16px;
}
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
.setting-copy p {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.switch > input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.switch:has(input:focus-visible) > span:not(.visually-hidden) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
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
@media (max-width: 680px) {
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
}
@media (prefers-reduced-motion: reduce) {
  .switch > span,
  .switch > span::after {
    transition: none;
  }
}
</style>
