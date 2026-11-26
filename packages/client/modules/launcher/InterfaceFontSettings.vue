<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import UiControl from "../../common/ui/UiControl.vue";
import InterfaceSettingsGroup from "./InterfaceSettingsGroup.vue";
import { useId } from "vue";
import { useAppearanceFontSettings } from "../appearance/index.ts";
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
function fontProgress(key: "chat" | "terminal") {
  return `${((fontDraft.value[key] - fontMin) / (fontMax - fontMin)) * 100}%`;
}
</script>

<template>
  <InterfaceSettingsGroup
    icon="type"
    title="Размер текста"
    description="Настройте читаемость содержимого, не меняя масштаб самого интерфейса."
  >
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
  </InterfaceSettingsGroup>
</template>

<style scoped>
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
@media (max-width: 460px) {
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
  .font-range::-webkit-slider-thumb {
    transition: none;
  }
}
</style>
