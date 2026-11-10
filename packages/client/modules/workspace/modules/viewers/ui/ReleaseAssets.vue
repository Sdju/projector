<script setup lang="ts">
import { computed } from "vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import type { ReleaseAsset } from "@ai-projector/core/modules/workspace/index.ts";
import { countRu } from "../../../../../common/utilities/plural.ts";
import { downloadsLabel, sizeLabel } from "../../../../../common/utilities/release-format.ts";

/** Attached files, external links and generated source archives of one release. */
const props = defineProps<{ assets: ReleaseAsset[] }>();
const files = computed(() => props.assets.filter((asset) => !asset.source));
const sources = computed(() => props.assets.filter((asset) => asset.source));
const total = computed(() => props.assets.length);
</script>

<template>
  <section v-if="total" class="release-assets" aria-label="Файлы релиза">
    <div class="assets-head">
      <h3>Файлы</h3>
      <span class="count">{{ countRu(total, "файл", "файла", "файлов") }}</span>
    </div>
    <div v-if="files.length" class="group">
      <ul class="asset-list">
        <li v-for="asset in files" :key="asset.id" class="asset">
          <span class="asset-text">
            <span class="asset-name" :title="asset.name">{{ asset.name }}</span>
            <span class="asset-meta">
              <span v-if="sizeLabel(asset.size)">{{ sizeLabel(asset.size) }}</span>
              <span v-if="downloadsLabel(asset.downloads)">{{
                downloadsLabel(asset.downloads)
              }}</span>
              <span v-if="asset.digest" class="mono digest" :title="asset.digest">{{
                asset.digest.length > 28 ? `${asset.digest.slice(0, 28)}…` : asset.digest
              }}</span>
            </span>
          </span>
          <span v-if="asset.uploading" class="pending">загружается</span>
          <a
            v-else-if="asset.external"
            class="asset-action"
            :href="asset.url"
            target="_blank"
            rel="noopener noreferrer"
            >Открыть</a
          >
          <a v-else class="asset-action" :href="asset.url" :download="asset.name">Скачать</a>
        </li>
      </ul>
    </div>
    <div v-if="sources.length" class="group">
      <h4>Исходный код</h4>
      <ul class="asset-list">
        <li v-for="asset in sources" :key="asset.id" class="asset">
          <span class="asset-text">
            <span class="asset-name">{{ asset.name }}</span>
            <span class="asset-meta">{{ asset.contentType }}</span>
          </span>
          <a class="asset-action" :href="asset.url" :download="asset.name">Скачать</a>
        </li>
      </ul>
    </div>
  </section>
  <UiHint v-else size="xs" leading="inherit" :space-before="2" class="note"
    >Файлов и исходников нет</UiHint
  >
</template>

<style scoped>
.release-assets {
  margin-top: var(--sp-4);
}
.assets-head,
.group h4 {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  margin: 0 0 var(--sp-1);
  color: var(--text-2);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.assets-head h3 {
  margin: 0;
  font-size: var(--fs-xs);
  font-weight: 600;
}
.group + .group {
  margin-top: var(--sp-3);
}
.count {
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 400;
}
.asset-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}
.asset {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--line);
}
.asset-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.asset-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-2);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
.asset-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.mono {
  font-family: var(--mono);
}
.asset-action,
.pending {
  flex-shrink: 0;
  padding: 3px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text-2);
  font-size: var(--fs-2xs);
}
.asset-action:hover {
  border-color: var(--line-strong);
  background: var(--hover);
  color: var(--text);
}
.pending {
  color: var(--muted);
  border-color: transparent;
}
</style>
