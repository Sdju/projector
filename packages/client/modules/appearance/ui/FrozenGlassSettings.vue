<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { frozenGlass, frozenGlassStyle } from "@ai-projector/core/modules/appearance/index.ts";
import type { ThemeValues } from "@ai-projector/core/modules/plugins/index.ts";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiLabel from "../../../common/ui/UiLabel.vue";
import FrozenGlassSeedField from "./FrozenGlassSeedField.vue";

const props = defineProps<{ disabled: boolean }>();
const values = defineModel<ThemeValues>({ required: true });
const emit = defineEmits<{ submit: [] }>();
const wallpaperId = useId();
const blurId = useId();
const [seed, wallpaper, blur] = frozenGlass.settings;
const fileInput = ref<HTMLInputElement>();
const fileName = ref("");
const uploading = ref(false);
const uploadError = ref("");
const imageState = ref<"empty" | "loading" | "ready" | "error">("empty");
let objectUrl = "";
const wallpaperUrl = computed(() => String(values.value[wallpaper.id] ?? ""));
const seedValue = computed(() => String(values.value[seed.id] ?? seed.default));
const blurValue = computed(() => Number(values.value[blur.id] ?? blur.default));
const previewVars = computed(() => frozenGlassStyle({ [seed.id]: seedValue.value }));
const previewUrl = ref("");
const rangeProgress = computed(
  () => `${((blurValue.value - blur.min) / (blur.max - blur.min)) * 100}%`,
);
const busy = computed(() => props.disabled || uploading.value);

watch(
  wallpaperUrl,
  (url) => {
    uploadError.value = "";
    imageState.value = url ? "loading" : "empty";
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    previewUrl.value = url;
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
});

function clearWallpaper() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = "";
  }
  fileName.value = "";
  uploadError.value = "";
  previewUrl.value = "";
  values.value = { ...values.value, [wallpaper.id]: "" };
  if (fileInput.value) fileInput.value.value = "";
}

async function upload(file: File | undefined) {
  if (!file || busy.value) return;
  uploadError.value = "";
  if (!/^image\/(avif|gif|jpeg|png|webp)$/.test(file.type)) {
    uploadError.value = "Выберите изображение PNG, JPEG, WebP, AVIF или GIF.";
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    uploadError.value = "Изображение должно быть не больше 12 МБ.";
    return;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(file);
  previewUrl.value = objectUrl;
  imageState.value = "ready";
  fileName.value = file.name;
  uploading.value = true;
  try {
    const response = await fetch("/api/appearance/wallpaper", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить изображение");
    URL.revokeObjectURL(objectUrl);
    objectUrl = "";
    values.value = { ...values.value, [wallpaper.id]: data.url };
    previewUrl.value = data.url;
  } catch (error) {
    uploadError.value = error instanceof Error ? error.message : "Не удалось загрузить изображение";
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = "";
  }
}

function selectFile(event: Event) {
  void upload((event.target as HTMLInputElement).files?.[0]);
}

function dropFile(event: DragEvent) {
  if (busy.value) return;
  void upload(event.dataTransfer?.files[0]);
}
</script>

<template>
  <div class="frozen-settings">
    <div
      class="wallpaper-preview"
      :class="{ 'has-image': previewUrl && imageState !== 'error' }"
      :style="previewVars"
      @dragover.prevent
      @drop.prevent="dropFile"
    >
      <img
        v-if="previewUrl && imageState !== 'error'"
        :src="previewUrl"
        alt="Выбранный фон интерфейса"
        @load="imageState = 'ready'"
        @error="imageState = 'error'"
      />
      <div class="glass-panel" :style="{ backdropFilter: `blur(${blurValue}px)` }">
        <div class="glass-toolbar"><i /><i /><i /><span>Projector</span></div>
        <div class="glass-content">
          <span class="glass-avatar">P</span>
          <div>
            <strong>Стеклянная панель</strong>
            <p>Фон виден сквозь интерфейс</p>
          </div>
        </div>
      </div>
      <span class="preview-caption">Предпросмотр · размытие {{ blurValue }} px</span>
      <span v-if="uploading" class="uploading">Загрузка изображения…</span>
    </div>

    <div class="wallpaper-fields">
      <FrozenGlassSeedField
        :field="seed"
        :disabled="busy"
        :model-value="seedValue"
        @update:model-value="values = { ...values, [seed.id]: $event }"
      />
      <UiLabel :for="wallpaperId">{{ wallpaper.title }}</UiLabel>
      <div class="url-control">
        <UiControl
          :id="wallpaperId"
          type="url"
          maxlength="4096"
          placeholder="https://…"
          :disabled="busy"
          :model-value="values[wallpaper.id]"
          @update:model-value="values = { ...values, [wallpaper.id]: String($event) }"
          @keydown.enter.prevent="emit('submit')"
        />
        <UiButton
          v-if="wallpaperUrl"
          shape="icon"
          size="sm"
          title="Убрать фоновое изображение"
          aria-label="Убрать фоновое изображение"
          :disabled="busy"
          @click="clearWallpaper"
          ><ProjectorIcon name="x"
        /></UiButton>
      </div>
      <div class="file-picker">
        <input
          :id="`${wallpaperId}-file`"
          ref="fileInput"
          class="visually-hidden"
          type="file"
          accept="image/avif,image/gif,image/jpeg,image/png,image/webp"
          :disabled="busy"
          @change="selectFile"
        />
        <UiButton size="sm" :disabled="busy" @click="fileInput?.click()">
          <ProjectorIcon name="upload" />Выбрать файл
        </UiButton>
        <span>{{ fileName || "или перетащите на предпросмотр" }}</span>
      </div>
      <UiHint>
        Файл или изображение по ссылке сохраняется на диске. PNG, JPEG, WebP, AVIF, GIF · до 12 МБ.
      </UiHint>
      <p v-if="imageState === 'error'" class="image-error" role="alert">
        Предпросмотр недоступен. При применении Projector попробует скачать изображение.
      </p>
      <p v-if="uploadError" class="image-error" role="alert">{{ uploadError }}</p>
    </div>

    <div class="blur-setting">
      <div class="blur-heading">
        <UiLabel :for="blurId">{{ blur.title }}</UiLabel>
        <output :for="blurId">{{ blurValue }} <span>px</span></output>
      </div>
      <UiControl
        :id="blurId"
        class="glass-range"
        type="range"
        :min="blur.min"
        :max="blur.max"
        :step="1"
        :disabled="busy"
        :model-value="values[blur.id]"
        :style="{ '--range-progress': rangeProgress }"
        @update:model-value="values = { ...values, [blur.id]: Number($event) }"
      />
      <div class="range-labels"><span>Без размытия</span><span>{{ blur.max }} px</span></div>
    </div>
  </div>
</template>

<style scoped>
.frozen-settings {
  display: grid;
  grid-template-columns: minmax(240px, 1.15fr) minmax(220px, 1fr);
  gap: var(--sp-4);
  padding: var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
}
.wallpaper-preview {
  position: relative;
  grid-row: span 2;
  min-height: 230px;
  overflow: hidden;
  border-radius: var(--r-sm);
  background: var(--theme-wallpaper-fallback), var(--canvas);
  isolation: isolate;
}
.wallpaper-preview > img {
  position: absolute;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.glass-panel {
  position: absolute;
  inset: 38px 24px 44px;
  overflow: hidden;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--theme-surface);
  box-shadow: var(--shadow-popover);
  color: var(--text);
}
.glass-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 9px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--theme-chrome);
  font-size: 10px;
}
.glass-toolbar i {
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
  background: var(--muted);
}
.glass-toolbar span {
  margin-left: 5px;
}
.glass-content {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 22px 14px;
}
.glass-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--accent) 27%, transparent);
  font-size: 12px;
  font-weight: 600;
}
.glass-content strong {
  font-size: 12px;
}
.glass-content p {
  margin: 4px 0 0;
  color: var(--text-2);
  font-size: 10px;
}
.preview-caption,
.uploading {
  position: absolute;
  bottom: 12px;
  left: 14px;
  color: var(--text);
  font-size: var(--fs-2xs);
  text-shadow: 0 1px 4px #000;
}
.uploading {
  top: 12px;
  right: 12px;
  bottom: auto;
  left: auto;
  padding: 4px 7px;
  border-radius: var(--r-sm);
  background: var(--overlay);
}
.wallpaper-fields {
  display: grid;
  align-content: start;
  gap: var(--sp-2);
  min-width: 0;
}
.url-control {
  display: flex;
  gap: var(--sp-2);
}
.url-control > input {
  flex: 1;
  min-width: 0;
}
.file-picker {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  min-width: 0;
}
.file-picker button {
  flex-shrink: 0;
}
.file-picker button svg {
  width: 14px;
  height: 14px;
}
.file-picker > span {
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}
.image-error {
  margin: 0;
  color: var(--err);
  font-size: var(--fs-xs);
  line-height: var(--lh);
}
.blur-setting {
  min-width: 0;
}
.blur-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-2);
}
.blur-heading output {
  min-width: 54px;
  padding: 3px 7px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  text-align: center;
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.blur-heading output span {
  color: var(--muted);
  font-family: var(--sans);
  font-size: var(--fs-2xs);
}
.glass-range {
  width: 100%;
  height: 20px;
  margin: 0;
  appearance: none;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.glass-range::-webkit-slider-runnable-track {
  height: 4px;
  border: 0;
  border-radius: var(--r-full);
  background: linear-gradient(
    to right,
    var(--focus) var(--range-progress),
    var(--bg-4) var(--range-progress)
  );
}
.glass-range::-moz-range-track {
  height: 4px;
  border: 0;
  border-radius: var(--r-full);
  background: var(--bg-4);
}
.glass-range::-moz-range-progress {
  height: 4px;
  border-radius: var(--r-full);
  background: var(--focus);
}
.glass-range::-webkit-slider-thumb {
  width: 16px;
  height: 16px;
  margin-top: -6px;
  appearance: none;
  border: 3px solid var(--bg);
  border-radius: var(--r-full);
  background: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.glass-range::-moz-range-thumb {
  width: 10px;
  height: 10px;
  border: 3px solid var(--bg);
  border-radius: var(--r-full);
  background: var(--focus);
  box-shadow: 0 0 0 1px var(--focus);
}
.range-labels {
  display: flex;
  justify-content: space-between;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
@media (max-width: 680px) {
  .frozen-settings {
    grid-template-columns: 1fr;
  }
  .wallpaper-preview {
    grid-row: auto;
    min-height: 210px;
  }
}
</style>
