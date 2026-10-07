<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from "vue";
import { useEventListener } from "@vueuse/core";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiIsland from "../../../../../common/ui/UiIsland.vue";
import { useIslandMenu } from "../../../../../common/utilities/island-menu.ts";
import { commandArgs, useCommandScope } from "../../../../../common/utilities/commands.ts";
import { useCompactViewport } from "../../../../../common/utilities/compact-viewport.ts";
import ImageViewport from "./ImageViewport.vue";
import SplitPanes from "./SplitPanes.vue";
import SvgParameters from "./SvgParameters.vue";
import IconSliders from "~icons/lucide/sliders-horizontal";
import IconExpand from "~icons/lucide/maximize-2";
import IconShrink from "~icons/lucide/minimize-2";
import { svgPreview } from "../lib/svg-preview.ts";
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
const color = ref("#d8d2c4");
const size = ref(256);
const background = ref("checker");
const backgroundColor = ref("#808080");
const fullscreen = ref(false);
const backgrounds = ["light", "dark", "checker", "gradient", "color-gradient", "custom"];
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
// On a phone the render is the whole point: controls float over it and the code starts collapsed.
const floating = computed(() => compact.value || fullscreen.value);
const settings = useIslandMenu({
  anchor: "right",
  initialFocus: ["input", "select"],
  items: "input,select,button",
});
function resetParameters() {
  color.value = "#d8d2c4";
  size.value = 256;
  background.value = "checker";
  backgroundColor.value = "#808080";
}

// The whole document goes fullscreen where the browser allows it, so the settings island stays visible.
let native = false;
function setFullscreen(on: boolean) {
  if (on === fullscreen.value) return;
  fullscreen.value = on;
  settings.close(false);
  if (on) {
    native = !!document.documentElement.requestFullscreen;
    void document.documentElement.requestFullscreen?.().catch(() => (native = false));
  } else if (document.fullscreenElement) {
    native = false;
    void document.exitFullscreen().catch(() => {});
  }
}
useEventListener(document, "fullscreenchange", () => {
  if (!document.fullscreenElement && native) {
    native = false;
    fullscreen.value = false;
  }
});
useEventListener(window, "keydown", (event) => {
  if (event.key === "Escape" && fullscreen.value && !settings.open.value) setFullscreen(false);
});
onBeforeUnmount(() => setFullscreen(false));

const commands = useCommandScope(`svg-viewer:${props.path}`, () => ({
  surface: "svg-viewer",
  path: props.path,
}));
commands.scope.registerCommand({
  id: "ide.svg.fullscreen.toggle",
  title: "SVG: полноэкранный просмотр",
  description: "Открывает или закрывает просмотр SVG на весь экран без панелей и кода.",
  run: () => setFullscreen(!fullscreen.value),
});
commands.scope.registerCommand({
  id: "ide.svg.parameters.toggle",
  title: "SVG: показать или скрыть параметры",
  description: "Открывает панель параметров просмотра SVG: цвет currentColor, размер и фон.",
  run: () => void settings.toggle(),
});
commands.scope.registerCommand({
  id: "ide.svg.parameters.set",
  title: "SVG: изменить параметры просмотра",
  description:
    "Задаёт цвет currentColor, размер рендера в пикселях и фон просмотра SVG; можно указать любые из параметров.",
  arguments: {
    color: "Цвет currentColor, #rrggbb",
    size: "Размер длинной стороны, 8–2048 px",
    background: `Фон: ${backgrounds.join(", ")}`,
    backgroundColor: "Цвет фона #rrggbb, используется при background=custom",
  },
  run: (value) => {
    const args = commandArgs(value);
    const hex = /^#[0-9a-f]{6}$/i;
    const next = {
      color: color.value,
      size: size.value,
      background: background.value,
      backgroundColor: backgroundColor.value,
    };
    if (args.color !== undefined) {
      if (typeof args.color !== "string" || !hex.test(args.color))
        throw new Error("color: цвет вида #rrggbb");
      next.color = args.color;
    }
    if (args.backgroundColor !== undefined) {
      if (typeof args.backgroundColor !== "string" || !hex.test(args.backgroundColor))
        throw new Error("backgroundColor: цвет вида #rrggbb");
      next.backgroundColor = args.backgroundColor;
    }
    if (args.size !== undefined) {
      if (
        typeof args.size !== "number" ||
        !Number.isFinite(args.size) ||
        args.size < 8 ||
        args.size > 2048
      )
        throw new Error("size: число от 8 до 2048");
      next.size = Math.round(args.size);
    }
    if (args.background !== undefined) {
      if (typeof args.background !== "string" || !backgrounds.includes(args.background))
        throw new Error(`background: ${backgrounds.join(", ")}`);
      next.background = args.background;
    }
    color.value = next.color;
    size.value = next.size;
    background.value = next.background;
    backgroundColor.value = next.backgroundColor;
  },
});
commands.scope.registerCommand({
  id: "ide.svg.parameters.reset",
  title: "SVG: сбросить параметры просмотра",
  description: "Возвращает исходные currentColor, размер и фон просмотра SVG.",
  run: resetParameters,
});
</script>

<template>
  <section
    class="svg-viewer"
    :class="{ fullscreen }"
    aria-label="Просмотр SVG"
    @pointerdown="commands.scope.activate()"
  >
    <div v-if="!compact" v-show="!fullscreen" class="toolbar">
      <SvgParameters
        v-model:color="color"
        v-model:size="size"
        v-model:background="background"
        v-model:background-color="backgroundColor"
        variant="bar"
        @reset="resetParameters"
      />
      <UiButton
        icon
        size="sm"
        aria-label="Во весь экран"
        title="Просмотр SVG на весь экран"
        @click="commands.run('ide.svg.fullscreen.toggle')"
      >
        <IconExpand aria-hidden="true" />
      </UiButton>
    </div>
    <SplitPanes :reveal="line" :initial="compact ? 1 : 0.45" :solo="fullscreen">
      <template #top>
        <div class="render-pane">
          <div v-if="!compact" v-show="!fullscreen" class="render-info">
            {{ dimensions.width }} × {{ dimensions.height }} px
            <span
              >Исходный: {{ Math.round(preview.width) }} × {{ Math.round(preview.height) }}</span
            >
          </div>
          <div class="stage">
            <ImageViewport
              :src="preview.url"
              :alt="path"
              :identity="path"
              :width="dimensions.width"
              :height="dimensions.height"
              :fit="floating"
              :floating="floating"
              :background="background"
              :background-controls="false"
              :background-color="backgroundColor"
              :error="preview.error"
            />
            <template v-if="floating">
              <span class="chip">{{ dimensions.width }} × {{ dimensions.height }}</span>
              <div class="actions">
                <span :ref="settings.trigger">
                  <UiButton
                    icon
                    class="float"
                    aria-label="Параметры"
                    title="Параметры: цвет, размер, фон"
                    aria-haspopup="dialog"
                    :aria-expanded="settings.open.value"
                    :aria-controls="settings.open.value ? settings.id : undefined"
                    @click="commands.run('ide.svg.parameters.toggle')"
                  >
                    <IconSliders aria-hidden="true" />
                  </UiButton>
                </span>
                <UiButton
                  icon
                  class="float"
                  :aria-label="fullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'"
                  :title="fullscreen ? 'Выйти из полноэкранного режима (Esc)' : 'На весь экран'"
                  @click="commands.run('ide.svg.fullscreen.toggle')"
                >
                  <component :is="fullscreen ? IconShrink : IconExpand" aria-hidden="true" />
                </UiButton>
              </div>
            </template>
          </div>
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
    <UiIsland :menu="settings" label="Параметры SVG" :width="320">
      <SvgParameters
        v-model:color="color"
        v-model:size="size"
        v-model:background="background"
        v-model:background-color="backgroundColor"
        variant="sheet"
        @reset="resetParameters"
      />
    </UiIsland>
  </section>
</template>

<style scoped>
.svg-viewer {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
/* Полный экран закрывает всё приложение, но остаётся ниже островов. */
.svg-viewer.fullscreen {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-popover) - 1);
  background: var(--bg);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.toolbar :deep(.params) {
  flex: 1;
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
.stage {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.chip {
  position: absolute;
  top: var(--sp-3);
  left: var(--sp-3);
  padding: 2px var(--sp-2);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-2) 90%, transparent);
  color: var(--text);
  font: var(--fs-2xs) var(--mono);
  pointer-events: none;
}
.actions {
  position: absolute;
  top: var(--sp-2);
  right: var(--sp-2);
  display: flex;
  gap: var(--sp-1);
  padding-top: env(safe-area-inset-top);
}
.float {
  border-color: transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-2) 88%, transparent);
  backdrop-filter: blur(8px);
}
</style>
