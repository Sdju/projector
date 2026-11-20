<script setup lang="ts">
import type { MediaArtifact, MediaJob } from "@ai-projector/core/modules/media/index.ts";
import { computed, inject, onBeforeUnmount, ref, watch } from "vue";
import ImageModal from "../../../../common/ui/ImageModal.vue";
import { chatImageSource, chatProjectKey } from "../../../chat-images/index.ts";
import { fetchMediaJob, mediaFileUrl } from "../../../media/index.ts";

const RUNNING = new Set(["queued", "running"]);

const props = defineProps<{
  jobId?: string;
  fileId?: string;
  kind?: "image" | "audio" | "video" | "text";
  alt?: string;
  caption?: string;
  height?: number;
}>();

const projectId = inject(chatProjectKey, "");
const job = ref<MediaJob>();
const loading = ref(false);
const error = ref("");
const viewing = ref<string>();
const failed = ref<Record<number, boolean>>({});
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;

/** A file without a job: the artifact id is enough, `kind` says how to show it. */
const direct = computed<MediaArtifact[]>(() => {
  const fileId = props.fileId?.trim();
  return fileId ? [{ kind: props.kind ?? "image", mime: "", fileId }] : [];
});
const artifacts = computed(() => job.value?.artifacts ?? direct.value);
const running = computed(() => !!job.value && RUNNING.has(job.value.status));
const progress = computed(() =>
  typeof job.value?.progress === "number" ? job.value.progress : undefined,
);
const style = computed(() => ({
  height: `${Math.max(80, Math.min(1200, props.height ?? 240))}px`,
  objectFit: "contain" as const,
}));

function source(artifact: MediaArtifact): string | undefined {
  const value = artifact.fileId ? mediaFileUrl(artifact.fileId) : artifact.url;
  return value ? chatImageSource(value, projectId) : undefined;
}

function stopPolling(): void {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
}

function schedule(next: MediaJob): void {
  stopPolling();
  if (disposed || !RUNNING.has(next.status)) return;
  timer = setTimeout(() => void load(), 1500);
}

async function load(): Promise<void> {
  stopPolling();
  const id = props.jobId?.trim();
  if (!id) {
    job.value = undefined;
    error.value = "";
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const next = await fetchMediaJob(id);
    if (disposed) return;
    job.value = next;
    error.value = "";
    schedule(next);
  } catch (err) {
    if (disposed) return;
    error.value = err instanceof Error ? err.message : "Не удалось прочитать задачу";
  } finally {
    if (!disposed) loading.value = false;
  }
}

watch(
  () => [props.jobId, props.fileId],
  () => {
    job.value = undefined;
    error.value = "";
    viewing.value = undefined;
    failed.value = {};
    void load();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  disposed = true;
  stopPolling();
});
</script>

<template>
  <div class="media">
    <p v-if="loading && !job" class="note">Загружаю медиа…</p>
    <p v-else-if="error" class="note error">
      {{ error }}
      <button type="button" class="retry" @click="load">Повторить</button>
    </p>

    <div v-if="running" class="status">
      <span>{{ job?.status === "queued" ? "В очереди" : "Выполняется" }}</span>
      <span v-if="progress !== undefined">{{ Math.round(progress * 100) }}%</span>
    </div>
    <p v-if="job?.error" class="note error">{{ job.error }}</p>

    <figure v-for="(artifact, index) in artifacts" :key="artifact.fileId ?? artifact.url ?? index">
      <template v-if="artifact.kind === 'image'">
        <button
          v-if="source(artifact) && !failed[index]"
          type="button"
          class="preview"
          :aria-label="alt ? `Открыть изображение: ${alt}` : 'Открыть изображение'"
          @click="viewing = source(artifact)"
        >
          <img
            :src="source(artifact)"
            :alt="alt || 'Изображение'"
            :style="style"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            @error="failed[index] = true"
          />
        </button>
        <a
          v-else-if="source(artifact)"
          class="file"
          :href="source(artifact)"
          target="_blank"
          rel="noopener noreferrer"
          >{{ alt || "Изображение" }}</a
        >
        <span v-else class="note">{{ alt || "Изображение" }}</span>
      </template>

      <audio v-else-if="artifact.kind === 'audio'" controls :src="source(artifact)" />

      <video
        v-else-if="artifact.kind === 'video'"
        controls
        :src="source(artifact)"
        :style="{ maxHeight: style.height }"
      />

      <template v-else-if="artifact.kind === 'text'">
        <pre v-if="artifact.text">{{ artifact.text }}</pre>
        <a
          v-else-if="source(artifact)"
          class="file"
          :href="source(artifact)"
          target="_blank"
          rel="noopener noreferrer"
          >Открыть текст</a
        >
      </template>
    </figure>

    <p v-if="!loading && !error && !artifacts.length && job?.status === 'succeeded'" class="note">
      Задача завершилась без файлов.
    </p>
    <p v-if="caption" class="caption">{{ caption }}</p>
  </div>
  <ImageModal v-if="viewing" :src="viewing" :alt="alt || 'Медиа'" @close="viewing = undefined" />
</template>

<style scoped>
.media {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
}
figure {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  min-width: 0;
}
.preview {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
img {
  display: block;
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--theme-inset-background, var(--bg-2));
}
audio,
video {
  width: 100%;
  max-width: 100%;
  border-radius: var(--r-md);
  background: var(--theme-inset-background, var(--bg-2));
}
pre {
  margin: 0;
  padding: var(--sp-3);
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--theme-inset-background, var(--bg-2));
  font: inherit;
}
.status {
  display: flex;
  justify-content: space-between;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.note,
.caption {
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
.error {
  color: var(--err);
}
.retry {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  text-decoration: underline;
  cursor: pointer;
}
.file {
  color: var(--muted);
  font-size: var(--fs-xs);
  overflow-wrap: anywhere;
}
</style>
