<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { GitCommitDetail } from "../../../../core/modules/workspace/index.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import { FileIcon, useFileIconTheme } from "../../file-icons/index.ts";
import { workspaceRequest } from "../api.ts";
import { absoluteTime, relativeTime, shortHash } from "../lib/commit-format.ts";
import IconCopy from "~icons/lucide/copy";

/** Вкладка «Обзор коммита»: сообщение, метаданные и все файлы коммита с числом строк. */
const props = defineProps<{ projectId: string; hash: string }>();
const emit = defineEmits<{
  openCommit: [hash: string];
  openDiff: [hash: string, path: string];
  subject: [text: string];
}>();
const detail = ref<GitCommitDetail>();
const error = ref("");
const loading = ref(false);
const copied = ref(false);
const { resolver } = useFileIconTheme();
let generation = 0;
async function load() {
  const current = ++generation;
  loading.value = true;
  error.value = "";
  detail.value = undefined;
  try {
    const data = await workspaceRequest<GitCommitDetail>(props.projectId, "commit", {
      hash: props.hash,
    });
    if (current !== generation) return;
    detail.value = data;
    emit("subject", data.subject);
  } catch (err) {
    if (current === generation) error.value = err instanceof Error ? err.message : "Ошибка Git";
  } finally {
    if (current === generation) loading.value = false;
  }
}
watch(() => [props.projectId, props.hash], load, { immediate: true });
const files = computed(() =>
  (detail.value?.files ?? []).map((file) => ({
    ...file,
    name: file.path.split("/").at(-1)!,
    directory: file.path.split("/").slice(0, -1).join("/"),
    icon: resolver.value.resolve(
      { name: file.path.split("/").at(-1)!, path: file.path, directory: false },
      false,
    ),
    // Share of changed lines that are additions; binary files have no bar.
    share:
      file.additions + file.deletions ? file.additions / (file.additions + file.deletions) : 0,
  })),
);
const sameCommitter = computed(
  () => detail.value && detail.value.committer === detail.value.author,
);
async function copy() {
  await navigator.clipboard.writeText(props.hash);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="overview">
    <p v-if="loading" class="note" role="status">загрузка коммита…</p>
    <p v-else-if="error" class="note error" role="alert">{{ error }}</p>
    <article v-else-if="detail">
      <h2>{{ detail.subject || "(без описания)" }}</h2>
      <p class="refs" v-if="detail.refs.length">
        <span v-for="ref in detail.refs" :key="ref.kind + ref.name" class="ref" :class="ref.kind">
          {{ ref.name }}
        </span>
      </p>
      <pre v-if="detail.body" class="body">{{ detail.body }}</pre>
      <dl>
        <dt>Хеш</dt>
        <dd>
          <code>{{ detail.hash }}</code>
          <UiButton
            icon
            size="sm"
            :title="copied ? 'Скопировано' : 'Копировать хеш'"
            aria-label="Копировать хеш"
            data-command="ide.git.commit.copyHash"
            @click="copy"
          >
            <IconCopy aria-hidden="true" />
          </UiButton>
        </dd>
        <dt>Автор</dt>
        <dd>
          {{ detail.author }} <span class="muted">&lt;{{ detail.email }}&gt;</span>
        </dd>
        <dt>Дата</dt>
        <dd>
          {{ absoluteTime(detail.date) }}
          <span class="muted">· {{ relativeTime(detail.date) }}</span>
        </dd>
        <template v-if="!sameCommitter">
          <dt>Коммит</dt>
          <dd>
            {{ detail.committer }}
            <span class="muted">· {{ absoluteTime(detail.committerDate) }}</span>
          </dd>
        </template>
        <dt>{{ detail.parents.length > 1 ? "Родители" : "Родитель" }}</dt>
        <dd>
          <span v-if="!detail.parents.length" class="muted">корневой коммит</span>
          <button
            v-for="parent in detail.parents"
            :key="parent"
            class="link"
            data-command="ide.git.commit.open"
            @click="emit('openCommit', parent)"
          >
            {{ shortHash(parent) }}
          </button>
        </dd>
      </dl>
      <h3>
        Файлы <span>{{ files.length }}</span>
        <b class="add">+{{ detail.additions }}</b>
        <b class="del">−{{ detail.deletions }}</b>
      </h3>
      <p v-if="detail.parents.length > 1" class="note">
        Слияние: показаны изменения относительно первого родителя.
      </p>
      <p v-if="!files.length" class="note">В этой папке коммит ничего не менял.</p>
      <ul v-else class="files">
        <li v-for="file in files" :key="file.path">
          <button
            :disabled="file.binary"
            :title="file.binary ? 'Бинарный файл' : 'Открыть изменения'"
            data-command="ide.git.commit.openDiff"
            @click="emit('openDiff', detail.hash, file.path)"
          >
            <b class="status" :class="file.status">{{ file.status }}</b>
            <FileIcon :icon="file.icon" />
            <span class="name">{{ file.name }}</span>
            <span class="dir">
              <template v-if="file.originalPath">{{ file.originalPath }} → </template
              >{{ file.directory }}
            </span>
            <span v-if="file.binary" class="muted">бинарный</span>
            <template v-else>
              <span v-if="file.additions + file.deletions" class="bar" aria-hidden="true">
                <i :style="{ width: `${file.share * 100}%` }" />
              </span>
              <span class="add">+{{ file.additions }}</span>
              <span class="del">−{{ file.deletions }}</span>
            </template>
          </button>
        </li>
      </ul>
    </article>
  </div>
</template>

<style scoped>
.overview {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--sp-4);
}
article {
  max-width: 880px;
}
h2 {
  margin: 0 0 var(--sp-2);
  font-size: var(--fs-lg, 1.1rem);
  font-weight: 600;
  overflow-wrap: anywhere;
}
h3 {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: var(--fs-2xs);
  letter-spacing: var(--track-label);
  text-transform: uppercase;
  font-weight: 500;
  color: var(--muted);
}
h3 span {
  color: var(--faint);
}
.refs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 var(--sp-2);
}
.ref {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  font: var(--fs-2xs) var(--mono);
  color: var(--muted);
}
.ref.head,
.ref.branch {
  color: var(--run);
}
.ref.tag {
  color: var(--accent);
}
.body {
  margin: 0 0 var(--sp-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: var(--fs-xs) var(--mono);
  color: var(--text);
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px var(--sp-3);
  margin: 0;
  font-size: var(--fs-xs);
}
dt {
  color: var(--faint);
}
dd {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  min-width: 0;
}
code {
  font: var(--fs-xs) var(--mono);
}
.muted {
  color: var(--muted);
}
.link {
  font: var(--fs-xs) var(--mono);
  color: var(--accent);
}
.link:hover {
  text-decoration: underline;
}
.files {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  overflow: hidden;
}
.files li + li {
  border-top: 1px solid var(--line);
}
.files button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px var(--sp-3);
  text-align: left;
  font-size: var(--fs-xs);
}
.files button:hover:not(:disabled) {
  background: var(--hover);
}
.files button:disabled {
  cursor: default;
  opacity: 0.7;
}
.status {
  width: 14px;
  font: var(--fs-2xs) var(--mono);
  color: var(--run);
}
.status.D {
  color: var(--err);
}
.status.R,
.status.C {
  color: var(--accent);
}
.name {
  flex-shrink: 0;
}
.dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.bar {
  width: 48px;
  height: 4px;
  flex-shrink: 0;
  border-radius: 2px;
  background: var(--err);
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  background: var(--run);
}
.add,
.del {
  flex-shrink: 0;
  font: var(--fs-2xs) var(--mono);
}
.add {
  color: var(--run);
}
.del {
  color: var(--err);
}
.note {
  margin: 0 0 var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.error {
  color: var(--err);
}
</style>
