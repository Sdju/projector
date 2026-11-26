<script setup lang="ts">
import ProjectorIcon from "../../common/icons/ProjectorIcon.vue";
import UiControl from "../../common/ui/UiControl.vue";

defineProps<{ disabled: boolean }>();
const mode = defineModel<string>({ required: true });
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
</script>

<template>
  <fieldset class="mode-grid" :disabled="disabled">
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
</template>

<style scoped>
.mode-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
.mode-card {
  position: relative;
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--text);
  cursor: pointer;
  transition:
    border-color var(--t-fast),
    background var(--t-fast),
    transform var(--t-fast);
}
.mode-card > input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.mode-card:hover {
  border-color: var(--line-strong);
  transform: translateY(-1px);
}
.mode-card:has(input:checked) {
  border-color: var(--focus);
  background: color-mix(in srgb, var(--selection) 60%, var(--bg));
}
.mode-card:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}
.mode-card:has(input:disabled) {
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
.mode-copy strong {
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
}
@media (prefers-reduced-motion: reduce) {
  .mode-card {
    transition: none;
  }
}
</style>
