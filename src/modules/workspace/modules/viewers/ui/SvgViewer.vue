<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from "vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import ImageViewport from "./ImageViewport.vue";
import SplitPanes from "./SplitPanes.vue";
import IconRotateCcw from "~icons/lucide/rotate-ccw";
import { svgPreview } from "../lib/svg-preview.ts";
import { useMediaQuery } from "@vueuse/core";
import { useCompactViewport } from "../../../../../common/utilities/compact-viewport.ts";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const props = defineProps<{
  path: string;
  content: string;
  editable?: boolean;
  line?: number;
  column?: number;
}>();
const emit = defineEmits<{ change: [content: string]; save: [] }>();
const compact = useCompactViewport();
const short = useMediaQuery("(max-height: 500px)");
// A phone in landscape has room for the render only: start with the code collapsed to a sliver.
const initialSplit = computed(() =>
  short.value && compact.value ? 0.85 : compact.value ? 0.62 : 0.45,
);
const color = ref("#d8d2c4");
const size = ref(256);
const background = ref("checker");
const backgroundColor = ref("#808080");
const preview = computed(() => {
  try {
    return { ...svgPreview(props.content, color.value), error: "" };
  } catch (error) {
    return { url: "", width: 1, height: 1, error: String((error as Error).message) };
  }
});
const dimensions = computed(() => {
  const { width, height } = preview.value;
  const longest = Math.max(width, height);
  const pixels = Math.max(8, Math.min(2048, Number(size.value) || 256));
  return {
    width: Math.max(1, Math.round((pixels * width) / longest)),
    height: Math.max(1, Math.round((pixels * height) / longest)),
  };
});
function resetParameters() {
  color.value = "#d8d2c4";
  size.value = 256;
  background.value = "checker";
  backgroundColor.value = "#808080";
}
</script>

<template>
  <section class="svg-viewer" aria-label="Просмотр SVG">
    <div class="toolbar">
      <label class="color-control"
        ><span class="caption">currentColor</span>
        <input v-model="color" type="color" aria-label="Цвет currentColor" />
        <span class="hex">{{ color }}</span></label
      >
      <label class="size-control"
        ><span class="caption">Размер</span>
        <input
          v-model.number="size"
          type="range"
          min="8"
          max="2048"
          step="1"
          aria-label="Размер SVG"
        />
      </label>
      <input
        v-model.number="size"
        class="size-input"
        type="number"
        min="8"
        max="2048"
        step="1"
        aria-label="Произвольный размер SVG в пикселях"
        @change="size = Math.max(8, Math.min(2048, Math.round(Number(size) || 256)))"
      />
      <label class="background-control"
        ><span class="caption">Фон</span>
        <select v-model="background" aria-label="Фон SVG">
          <option value="light">Светлый</option>
          <option value="dark">Тёмный</option>
          <option value="checker">Шашечки</option>
          <option value="gradient">Градиент</option>
          <option value="color-gradient">Цветной градиент</option>
          <option value="custom">Свой цвет</option>
        </select></label
      >
      <input
        v-if="background === 'custom'"
        v-model="backgroundColor"
        type="color"
        aria-label="Свой цвет фона SVG"
      />
      <UiButton
        class="reset"
        icon
        size="sm"
        aria-label="Сбросить параметры SVG"
        title="Вернуть исходные currentColor, размер и фон SVG"
        @click="resetParameters"
      >
        <IconRotateCcw aria-hidden="true" />
      </UiButton>
    </div>
    <SplitPanes :reveal="line" :initial="initialSplit">
      <template #top>
        <div class="render-pane">
          <div class="render-info">
            {{ dimensions.width }} × {{ dimensions.height }} px
            <span
              >Исходный: {{ Math.round(preview.width) }} × {{ Math.round(preview.height) }}</span
            >
          </div>
          <ImageViewport
            :src="preview.url"
            :alt="path"
            :identity="path"
            :width="dimensions.width"
            :height="dimensions.height"
            :fit="compact"
            :background="background"
            :background-controls="false"
            :background-color="backgroundColor"
            :error="preview.error"
          />
        </div>
      </template>
      <template #bottom>
        <CodeViewer
          :path="path"
          :content="content"
          :editable="editable"
          :line="line"
          :column="column"
          @change="emit('change', $event)"
          @save="emit('save')"
        />
      </template>
    </SplitPanes>
  </section>
</template>

<style scoped>
.svg-viewer {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--sp-2) var(--sp-4);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
  font-size: var(--fs-xs);
}
.toolbar label {
  display: flex;
  align-items: center;
  gap: 6px;
}
.toolbar select {
  width: auto;
  padding-block: var(--sp-1);
}
.size-control input[type="range"] {
  width: clamp(100px, 15vw, 180px);
}
.toolbar input[type="color"] {
  width: 28px;
  height: 26px;
  padding: 2px;
  background: transparent;
  cursor: pointer;
}
.color-control .hex {
  font-family: var(--mono);
}
.size-input {
  width: 72px;
  padding-block: var(--sp-1);
}
.reset {
  margin-left: auto;
}
.render-pane {
  flex: 1;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.render-info {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  padding: 6px var(--sp-3);
  font-size: var(--fs-2xs);
  color: var(--muted);
  border-bottom: 1px solid var(--line);
}
.render-info span {
  margin-left: auto;
}

/* Телефон: параметры раскладываются по строкам, а не переносятся как придётся. */
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 84px auto;
    align-items: center;
    gap: var(--sp-2) var(--sp-3);
    padding: var(--sp-2) var(--sp-3) var(--sp-3);
  }
  .color-control {
    grid-column: 1;
    min-width: 0;
  }
  .size-input {
    grid-column: 2;
    width: 100%;
  }
  .reset {
    grid-column: 3;
    margin-left: 0;
  }
  .size-control {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .size-control .caption {
    min-width: 3.5em;
  }
  .size-control input[type="range"] {
    flex: 1;
    width: auto;
    min-width: 0;
  }
  .background-control {
    grid-column: 1 / 3;
    grid-row: 3;
  }
  .background-control .caption {
    min-width: 3.5em;
  }
  .background-control select {
    flex: 1;
    min-width: 0;
  }
  .toolbar > input[type="color"] {
    grid-column: 3;
    grid-row: 3;
  }
  .render-info span {
    margin-left: 0;
  }
}
/* Телефон в ландшафте: вся панель параметров в одну строку, чтобы осталось место под рендер. */
@media (max-height: 500px) and (max-width: 1050px) {
  .toolbar {
    grid-template-columns: auto minmax(80px, 1fr) 84px minmax(0, 190px) auto;
    padding-block: var(--sp-1);
  }
  .toolbar > * {
    grid-row: 1 !important;
  }
  .color-control {
    grid-column: 1;
  }
  .size-control {
    grid-column: 2;
  }
  .size-control .caption,
  .background-control .caption,
  .color-control .caption {
    display: none;
  }
  .size-input {
    grid-column: 3;
  }
  .background-control {
    grid-column: 4;
  }
  .toolbar > input[type="color"] {
    grid-column: 5;
  }
  .reset {
    grid-column: 5;
  }
  .render-info {
    display: none;
  }
  .toolbar input:not([type="color"], [type="range"]),
  .toolbar select {
    min-height: 36px;
  }
}
</style>
