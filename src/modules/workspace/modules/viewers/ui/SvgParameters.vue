<script setup lang="ts">
import UiButton from "../../../../../common/ui/UiButton.vue";
import IconRotateCcw from "~icons/lucide/rotate-ccw";

/** Поля параметров просмотра SVG; `bar` — строка панели на десктопе, `sheet` — вертикальный список острова. */
defineProps<{ variant: "bar" | "sheet" }>();
defineEmits<{ reset: [] }>();
const color = defineModel<string>("color", { required: true });
const size = defineModel<number>("size", { required: true });
const background = defineModel<string>("background", { required: true });
const backgroundColor = defineModel<string>("backgroundColor", { required: true });
const clamp = () =>
  (size.value = Math.max(8, Math.min(2048, Math.round(Number(size.value) || 256))));
</script>

<template>
  <div class="params" :class="variant">
    <label class="field color-control">
      <span class="caption">currentColor</span>
      <span class="value">
        <input v-model="color" type="color" aria-label="Цвет currentColor" />
        <span class="hex">{{ color }}</span>
      </span>
    </label>
    <div class="field size-control">
      <label class="caption" for="svg-size">Размер, px</label>
      <span class="value">
        <input
          v-model.number="size"
          class="slider"
          type="range"
          min="8"
          max="2048"
          step="1"
          aria-label="Размер SVG"
        />
        <input
          id="svg-size"
          v-model.number="size"
          class="size-input"
          type="number"
          min="8"
          max="2048"
          step="1"
          aria-label="Произвольный размер SVG в пикселях"
          @change="clamp"
        />
      </span>
    </div>
    <label class="field background-control">
      <span class="caption">Фон</span>
      <span class="value">
        <select v-model="background" aria-label="Фон SVG">
          <option value="light">Светлый</option>
          <option value="dark">Тёмный</option>
          <option value="checker">Шашечки</option>
          <option value="gradient">Градиент</option>
          <option value="color-gradient">Цветной градиент</option>
          <option value="custom">Свой цвет</option>
        </select>
        <input
          v-if="background === 'custom'"
          v-model="backgroundColor"
          type="color"
          aria-label="Свой цвет фона SVG"
        />
      </span>
    </label>
    <UiButton
      class="reset"
      :icon="variant === 'bar'"
      size="sm"
      aria-label="Сбросить параметры SVG"
      title="Вернуть исходные currentColor, размер и фон SVG"
      @click="$emit('reset')"
    >
      <IconRotateCcw aria-hidden="true" />
      <template v-if="variant === 'sheet'">Сбросить</template>
    </UiButton>
  </div>
</template>

<style scoped>
.params {
  font-size: var(--fs-xs);
}
.field,
.value {
  display: flex;
  align-items: center;
  min-width: 0;
}
.value {
  gap: var(--sp-2);
}
input[type="color"] {
  width: 28px;
  height: 26px;
  padding: 2px;
  background: transparent;
  cursor: pointer;
}
.hex {
  font-family: var(--mono);
}
select {
  width: auto;
  padding-block: var(--sp-1);
}
.size-input {
  width: 72px;
  padding-block: var(--sp-1);
}
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-4);
}
.bar .field {
  gap: 6px;
}
.bar .slider {
  width: clamp(100px, 15vw, 180px);
}
.bar .reset {
  margin-left: auto;
}
.sheet {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3) var(--sp-3);
}
.sheet .field {
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-1);
}
.sheet .caption {
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.sheet .value > :is(select, .slider) {
  flex: 1;
}
.sheet .color-control .value {
  min-height: var(--control-h);
}
.sheet .reset {
  align-self: flex-start;
}
</style>
