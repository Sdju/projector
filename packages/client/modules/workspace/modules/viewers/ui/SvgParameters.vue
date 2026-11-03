<script setup lang="ts">
import UiLabel from "../../../../../common/ui/UiLabel.vue";
import UiControl from "../../../../../common/ui/UiControl.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import { useId } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import IconRotateCcw from "~icons/lucide/rotate-ccw";

/** Поля параметров просмотра SVG; `bar` — строка панели на десктопе, `sheet` — вертикальный список острова. */
defineProps<{ variant: "bar" | "sheet" }>();
defineEmits<{ reset: [] }>();
const sizeId = useId();
const color = defineModel<string>("color", { required: true });
const size = defineModel<number>("size", { required: true });
const background = defineModel<string>("background", { required: true });
const backgroundColor = defineModel<string>("backgroundColor", { required: true });
const clamp = () =>
  (size.value = Math.max(8, Math.min(2048, Math.round(Number(size.value) || 256))));
</script>

<template>
  <div class="params" :class="variant">
    <UiInline
      as="label"
      class="field color-control"
      :gap="variant === 'bar' ? 1.5 : 1"
      :align="variant === 'bar' ? 'center' : 'stretch'"
      justify="normal"
    >
      <UiLabel
        as="span"
        :size="variant === 'sheet' ? '2xs' : undefined"
        :tone="variant === 'sheet' ? 'muted' : undefined"
        >currentColor</UiLabel
      >
      <UiInline as="span" class="value" justify="normal">
        <UiControl
          v-model="color"
          type="color"
          appearance="swatch"
          aria-label="Цвет currentColor"
        />
        <span class="hex">{{ color }}</span>
      </UiInline>
    </UiInline>
    <UiInline
      class="field size-control"
      :gap="variant === 'bar' ? 1.5 : 1"
      :align="variant === 'bar' ? 'center' : 'stretch'"
      justify="normal"
    >
      <UiLabel
        :for="sizeId"
        :size="variant === 'sheet' ? '2xs' : undefined"
        :tone="variant === 'sheet' ? 'muted' : undefined"
        >Размер, px</UiLabel
      >
      <UiInline as="span" class="value" justify="normal">
        <UiControl
          v-model.number="size"
          class="slider"
          type="range"
          min="8"
          max="2048"
          step="1"
          aria-label="Размер SVG"
        />
        <UiControl
          :id="sizeId"
          v-model.number="size"
          class="size-input"
          type="number"
          min="8"
          max="2048"
          step="1"
          aria-label="Произвольный размер SVG в пикселях"
          @change="clamp"
        />
      </UiInline>
    </UiInline>
    <UiInline
      as="label"
      class="field background-control"
      :gap="variant === 'bar' ? 1.5 : 1"
      :align="variant === 'bar' ? 'center' : 'stretch'"
      justify="normal"
    >
      <UiLabel
        as="span"
        :size="variant === 'sheet' ? '2xs' : undefined"
        :tone="variant === 'sheet' ? 'muted' : undefined"
        >Фон</UiLabel
      >
      <UiInline as="span" class="value" justify="normal">
        <UiControl as="select" v-model="background" appearance="inline-select" aria-label="Фон SVG">
          <option value="light">Светлый</option>
          <option value="dark">Тёмный</option>
          <option value="checker">Шашечки</option>
          <option value="gradient">Градиент</option>
          <option value="color-gradient">Цветной градиент</option>
          <option value="custom">Свой цвет</option>
        </UiControl>
        <UiControl
          v-if="background === 'custom'"
          v-model="backgroundColor"
          type="color"
          appearance="swatch"
          aria-label="Свой цвет фона SVG"
        />
      </UiInline>
    </UiInline>
    <UiButton
      class="reset"
      :shape="variant === 'bar' ? 'icon' : 'rect'"
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
  min-width: 0;
}
.hex {
  font-family: var(--mono);
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
