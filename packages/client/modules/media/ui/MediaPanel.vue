<script setup lang="ts">
import type { MediaArtifact } from "@ai-projector/core/modules/media/index.ts";
import {
  formatMediaPrice,
  mediaCapabilityTitle,
  mediaModalityTitle,
} from "@ai-projector/core/modules/media/index.ts";
import { computed } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiHeading from "../../../common/ui/UiHeading.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiLoader from "../../../common/ui/UiLoader.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { mediaFileUrl } from "../api/client.ts";
import { useMediaPanel } from "../model/panel.ts";

const {
  loading,
  refreshing,
  submitting,
  error,
  capability,
  providerId,
  modelId,
  prompt,
  imageUrl,
  audioUrl,
  size,
  resolution,
  ratio,
  voice,
  duration,
  job,
  capabilityOptions,
  providerOptions,
  modelOptions,
  selectedModel,
  running,
  busy,
  canGenerate,
  ready,
  commands,
  refreshModels,
  submit,
  cancel,
  setCapability,
  setProvider,
  setModel,
} = useMediaPanel();

const artifacts = computed(() => job.value?.artifacts ?? []);
const modelOptionsList = computed(() => selectedModel.value?.options);
const progressLabel = computed(() =>
  job.value?.progress !== undefined ? `${Math.round((job.value.progress ?? 0) * 100)}%` : "",
);

/** What the model accepts and returns, as one readable line. */
const modelModalities = computed(() => {
  const model = selectedModel.value;
  if (!model) return [];
  const parts: string[] = [];
  if (model.input?.length) parts.push(`вход: ${model.input.map(mediaModalityTitle).join(", ")}`);
  if (model.output?.length) parts.push(`выход: ${model.output.map(mediaModalityTitle).join(", ")}`);
  if (model.languages?.length) parts.push(`языки: ${model.languages.join(", ")}`);
  return parts;
});

/** The date the rate card was checked, in the reader's locale. */
function checkedAt(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("ru-RU");
}

function setDuration(value: unknown): void {
  const number = typeof value === "string" && value ? Number(value) : Number.NaN;
  duration.value = Number.isFinite(number) ? number : null;
}

function artifactUrl(artifact: MediaArtifact): string {
  if (artifact.fileId) return mediaFileUrl(artifact.fileId);
  return artifact.url ?? "";
}

function statusLabel(): string {
  const status = job.value?.status;
  if (status === "queued") return "в очереди";
  if (status === "running") return "выполняется";
  if (status === "succeeded") return "готово";
  if (status === "failed") return "ошибка";
  if (status === "cancelled") return "отменено";
  return "";
}
</script>

<template>
  <section
    class="media-panel"
    @focusin="commands.scope.activate()"
    @pointerdown="commands.scope.activate()"
  >
    <UiHeading as="h2" size="sm">Генерация медиа</UiHeading>
    <UiHint>
      Изображения, синтез речи, распознавание и видео через провайдеров Projector. Модели приходят
      из адаптеров: вид провайдера выбирает реализацию, а раздел остаётся общим.
    </UiHint>

    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <UiLoader v-if="loading" size="sm">загрузка моделей…</UiLoader>

    <UiStack v-else-if="!ready" :gap="2">
      <UiHint>
        Нет включённого провайдера с медиа-адаптером. Добавьте провайдера в разделе «Модели и
        провайдеры» — встроенные адаптеры подключаются по виду провайдера.
      </UiHint>
      <UiInline :gap="2">
        <UiButton :disabled="refreshing" @click="refreshModels">Проверить снова</UiButton>
      </UiInline>
    </UiStack>

    <template v-else>
      <div class="media-grid">
        <label class="field">
          <span>Возможность</span>
          <UiControl
            as="select"
            name="media-capability"
            :model-value="capability"
            @update:model-value="setCapability($event)"
          >
            <option v-for="item in capabilityOptions" :key="item.value" :value="item.value">
              {{ item.label }}
            </option>
          </UiControl>
        </label>
        <label v-if="providerOptions.length > 1" class="field">
          <span>Провайдер</span>
          <UiControl
            as="select"
            name="media-provider"
            :model-value="providerId"
            @update:model-value="setProvider($event)"
          >
            <option v-for="item in providerOptions" :key="item.id" :value="item.id">
              {{ item.name }}
            </option>
          </UiControl>
        </label>
        <label class="field">
          <span>Модель</span>
          <UiControl
            as="select"
            name="media-model"
            :model-value="modelId"
            @update:model-value="setModel($event)"
          >
            <option v-for="item in modelOptions" :key="item.id" :value="item.id">
              {{ item.title ?? item.id }} · {{ item.id }}
            </option>
          </UiControl>
        </label>
      </div>

      <div v-if="selectedModel" class="model-info">
        <p v-if="selectedModel.description" class="model-description">
          {{ selectedModel.description }}
        </p>
        <UiInline class="model-meta" justify="normal">
          <span class="model-capability">{{ mediaCapabilityTitle(selectedModel.capability) }}</span>
          <span v-for="part in modelModalities" :key="part" class="model-detail">{{ part }}</span>
        </UiInline>
        <ul v-if="selectedModel.prices?.length" class="model-prices">
          <li v-for="(price, index) in selectedModel.prices" :key="index">
            {{ formatMediaPrice(price) }}
          </li>
        </ul>
        <p v-else-if="selectedModel.description" class="model-note">
          Провайдер не публикует цену для этой модели.
        </p>
        <p v-else class="model-note">
          О модели нет данных: провайдер не передаёт описание и тариф. Запрос всё равно уйдёт с её
          id.
        </p>
        <p v-if="selectedModel.priceSource" class="model-source">
          Тариф
          <a :href="selectedModel.priceSource" target="_blank" rel="noreferrer">провайдера</a>
          <template v-if="selectedModel.priceCheckedAt">
            · проверено {{ checkedAt(selectedModel.priceCheckedAt) }}
          </template>
          <template v-if="selectedModel.docs">
            · <a :href="selectedModel.docs" target="_blank" rel="noreferrer">документация</a>
          </template>
        </p>
        <p v-if="selectedModel.deprecated" class="model-note">
          Провайдер больше не рекомендует эту модель.
        </p>
      </div>

      <label v-if="capability === 'speech.transcribe'" class="field">
        <span>Ссылка на аудио</span>
        <UiControl
          v-model="audioUrl"
          name="media-audio-url"
          placeholder="https://example.com/a.wav"
          spellcheck="false"
        />
      </label>
      <label v-else class="field">
        <span>{{ capability === "speech.synthesize" ? "Текст" : "Запрос" }}</span>
        <UiControl
          v-model="prompt"
          name="media-prompt"
          as="textarea"
          :rows="capability === 'video.generate' ? 4 : 3"
          :placeholder="
            capability === 'speech.synthesize'
              ? 'Что произнести'
              : capability === 'video.generate'
                ? 'Опишите сцену и движение камеры'
                : 'Опишите изображение'
          "
        />
      </label>
      <label
        v-if="capability === 'image.generate' || capability === 'video.generate'"
        class="field"
      >
        <span>Исходное изображение (URL, необязательно)</span>
        <UiControl
          v-model="imageUrl"
          name="media-image-url"
          placeholder="https://example.com/source.png"
          spellcheck="false"
        />
      </label>

      <div v-if="modelOptionsList" class="media-grid options">
        <label v-if="modelOptionsList.sizes?.length" class="field">
          <span>Размер</span>
          <UiControl v-model="size" name="media-size" as="select">
            <option v-for="item in modelOptionsList.sizes" :key="item" :value="item">
              {{ item }}
            </option>
          </UiControl>
        </label>
        <label v-if="modelOptionsList.resolutions?.length" class="field">
          <span>Разрешение</span>
          <UiControl v-model="resolution" name="media-resolution" as="select">
            <option v-for="item in modelOptionsList.resolutions" :key="item" :value="item">
              {{ item }}
            </option>
          </UiControl>
        </label>
        <label v-if="modelOptionsList.ratios?.length" class="field">
          <span>Соотношение</span>
          <UiControl v-model="ratio" name="media-ratio" as="select">
            <option v-for="item in modelOptionsList.ratios" :key="item" :value="item">
              {{ item }}
            </option>
          </UiControl>
        </label>
        <label v-if="modelOptionsList.voices?.length" class="field">
          <span>Голос</span>
          <UiControl v-model="voice" name="media-voice" as="select">
            <option v-for="item in modelOptionsList.voices" :key="item" :value="item">
              {{ item }}
            </option>
          </UiControl>
        </label>
        <label v-if="modelOptionsList.durations?.length" class="field">
          <span>Длительность, с</span>
          <UiControl
            as="select"
            name="media-duration"
            :model-value="duration === null ? '' : String(duration)"
            @update:model-value="setDuration($event)"
          >
            <option v-for="item in modelOptionsList.durations" :key="item" :value="String(item)">
              {{ item }}
            </option>
          </UiControl>
        </label>
      </div>

      <UiInline class="actions" wrap :gap="2">
        <UiButton appearance="solid" :disabled="!canGenerate || busy" @click="submit">
          {{ submitting ? "Запуск…" : running ? "Задача выполняется…" : "Сгенерировать" }}
        </UiButton>
        <UiButton v-if="running" @click="cancel">Отменить</UiButton>
        <UiButton appearance="outline" tone="muted" :disabled="refreshing" @click="refreshModels">
          Обновить модели
        </UiButton>
        <UiButton v-if="job" @click="commands.run('ide.media.result.clear')">Очистить</UiButton>
      </UiInline>

      <UiStack v-if="job" class="result" :gap="2">
        <UiInline wrap justify="between">
          <strong>{{ statusLabel() }}</strong>
          <span class="meta">
            {{ job.model }} · {{ job.providerName }}
            <template v-if="progressLabel"> · {{ progressLabel }}</template>
          </span>
        </UiInline>
        <UiLoader v-if="running" size="sm">провайдер ещё работает…</UiLoader>
        <UiMessage v-if="job.error" tone="danger" size="xs" flush>{{ job.error }}</UiMessage>

        <template
          v-for="artifact in artifacts"
          :key="artifact.fileId ?? artifact.url ?? artifact.text"
        >
          <pre v-if="artifact.kind === 'text'" class="text">{{ artifact.text }}</pre>
          <img
            v-else-if="artifact.kind === 'image'"
            class="media"
            :src="artifactUrl(artifact)"
            :alt="`Изображение ${job.model}`"
          />
          <audio
            v-else-if="artifact.kind === 'audio'"
            class="media"
            :src="artifactUrl(artifact)"
            controls
          />
          <video
            v-else-if="artifact.kind === 'video'"
            class="media"
            :src="artifactUrl(artifact)"
            controls
          />
          <a
            v-if="artifact.kind !== 'text' && artifactUrl(artifact)"
            class="open-file"
            :href="artifactUrl(artifact)"
            target="_blank"
            rel="noreferrer"
            >Открыть файл</a
          >
        </template>
        <UiHint v-if="artifacts.some((item) => item.expiresAt)">
          Ссылка провайдера временная; Projector уже скачал файл локально.
        </UiHint>
      </UiStack>
    </template>
  </section>
</template>

<style scoped>
.media-panel {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}
.media-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--sp-2);
}
.media-grid.options {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}
.model-info {
  display: grid;
  gap: var(--sp-1);
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  font-size: var(--fs-xs);
}
.model-description {
  margin: 0;
  color: var(--text-2);
  line-height: 1.45;
}
.model-meta {
  flex-wrap: wrap;
  gap: var(--sp-1);
}
.model-capability {
  padding: 1px 6px;
  border-radius: var(--r-sm);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text-2);
  font-weight: 600;
}
.model-detail {
  color: var(--faint);
}
.model-prices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-1) var(--sp-3);
  margin: 0;
  padding: 0;
  list-style: none;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.model-note,
.model-source {
  margin: 0;
  color: var(--faint);
}
.model-source a {
  color: var(--accent);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: var(--fs-xs);
  color: var(--text-2);
}
.field > span {
  font-weight: 600;
}
.media {
  display: block;
  max-width: 100%;
  max-height: 360px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-sunken);
}
.text {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-sunken);
  font-family: var(--mono);
  font-size: var(--fs-xs);
  white-space: pre-wrap;
}
.actions,
.result {
  margin-top: var(--sp-1);
}
.meta {
  color: var(--text-2);
  font-size: var(--fs-xs);
}
.open-file {
  font-size: var(--fs-xs);
  color: var(--accent);
}
</style>
