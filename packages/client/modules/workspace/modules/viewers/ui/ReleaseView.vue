<script setup lang="ts">
import UiArticle from "../../../../../common/ui/UiArticle.vue";
import UiAvatar from "../../../../../common/ui/UiAvatar.vue";
import UiHeading from "../../../../../common/ui/UiHeading.vue";
import UiViewerPage from "../../../../../common/ui/UiViewerPage.vue";
import UiHint from "../../../../../common/ui/UiHint.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiMessage from "../../../../../common/ui/UiMessage.vue";
import { relativeTime, absoluteTime } from "../../../../../common/utilities/commit-format.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import { downloadsLabel, sizeLabel } from "../../../../../common/utilities/release-format.ts";
import {
  commandArgs,
  useCommandRegistrar,
  useCommandScope,
} from "../../../../../common/utilities/commands.ts";
import { useReleaseDetail } from "../lib/release-detail.ts";
import VisualMarkdownEditor from "./VisualMarkdownEditor.vue";
import ReleaseAssets from "./ReleaseAssets.vue";
import IconExternal from "~icons/lucide/external-link";

/** Release tab: tag, author, Markdown notes and downloadable files. */
const props = withDefaults(defineProps<{ projectId: string; tag: string; host?: string }>(), {
  host: "хостинге",
});
const { detail, loading, error, reload } = useReleaseDetail(
  () => props.projectId,
  () => props.tag,
);
const commands = useCommandScope(`release:${props.projectId}:${props.tag}`, () => ({
  surface: "release",
  projectId: props.projectId,
  tag: props.tag,
  host: props.host,
}));
const register = useCommandRegistrar(commands.scope);
register("ide.release.refresh", "Обновить релиз", "Перечитывает описание и файлы релиза.", () =>
  reload(),
);
register(
  "ide.release.asset.download",
  "Скачать файл релиза",
  "Открывает внутреннюю ссылку скачивания или страницу внешнего файла.",
  (value) => {
    const { id } = commandArgs(value);
    if (typeof id !== "string" || !id) throw new Error("Укажите id файла релиза");
    const asset = detail.value?.assets.find((item) => item.id === id);
    if (!asset) throw new Error("Файл релиза не найден");
    if (asset.uploading) throw new Error("Файл ещё загружается");
    if (asset.external) window.open(asset.url, "_blank", "noopener,noreferrer");
    else window.location.assign(asset.url);
  },
  { id: "string: id файла релиза" },
);

useTabReadout(() => {
  const note = `Release ${props.tag}`;
  if (error.value) return { note, text: `Ошибка: ${error.value}` };
  const data = detail.value;
  if (!data) return { note, text: "Загрузка…" };
  const release = data.release;
  const body = release.name && release.name !== release.tag ? release.name : "";
  const assets = data.assets.map((asset) => {
    const size = sizeLabel(asset.size);
    const downloads = downloadsLabel(asset.downloads);
    return `${asset.source ? "исходники" : asset.external ? "ссылка" : "файл"}: ${asset.name}${size ? ` (${size})` : ""}${downloads ? ` · ${downloads}` : ""}`;
  });
  return {
    note,
    text: readoutLines(
      `Тег: ${release.tag}`,
      body ? `Название: ${body}` : "",
      `Автор: ${release.author.login || "нет"}`,
      `Опубликован: ${release.releasedAt || release.createdAt}`,
      release.draft ? "Черновик" : "",
      release.prerelease ? "Пререлиз" : "",
      release.upcoming ? "Запланирован" : "",
      `Файлов: ${release.assetCount}`,
      release.downloads !== null ? `Скачиваний: ${release.downloads}` : "",
      data.body.length > 4000 ? `${data.body.slice(0, 4000)}…` : data.body,
      assets.length ? `Файлы:\n${assets.slice(0, 100).join("\n")}` : "Файлов нет",
      assets.length > 100 ? `Показано 100 файлов, остальные — на ${props.host}.` : "",
    ),
  };
});
</script>

<template>
  <UiViewerPage>
    <UiHint v-if="loading" size="xs" leading="inherit" role="status">загрузка: релиз…</UiHint>
    <UiMessage v-else-if="error" variant="note" tone="danger" size="xs" role="alert">{{
      error
    }}</UiMessage>
    <UiArticle v-else-if="detail">
      <UiInline as="header" class="head" align="baseline" wrap justify="normal">
        <span v-if="detail.release.draft" class="state">черновик</span>
        <span v-else-if="detail.release.prerelease" class="state">пререлиз</span>
        <span v-else-if="detail.release.upcoming" class="state">скоро</span>
        <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">
          {{
            detail.release.name && detail.release.name !== detail.release.tag
              ? detail.release.name
              : "Релиз"
          }}
          <span class="tag mono">{{ detail.release.tag }}</span>
        </UiHeading>
      </UiInline>
      <UiInline as="p" class="meta" wrap>
        <UiInline as="span" inline :gap="1.25" justify="normal" class="author">
          <UiAvatar
            :src="detail.release.author.avatarUrl"
            :alt="detail.release.author.login"
            :size="18"
          />
          {{ detail.release.author.login }}
        </UiInline>
        <span
          v-if="detail.release.releasedAt || detail.release.createdAt"
          :title="absoluteTime(detail.release.releasedAt || detail.release.createdAt)"
          >опубликован
          {{ relativeTime(detail.release.releasedAt || detail.release.createdAt) }}</span
        >
        <span v-if="detail.release.downloads">{{ downloadsLabel(detail.release.downloads) }}</span>
        <UiInline
          as="a"
          inline
          :gap="1"
          justify="normal"
          v-if="detail.release.htmlUrl"
          class="external"
          :href="detail.release.htmlUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          <IconExternal aria-hidden="true" />на {{ host }}
        </UiInline>
      </UiInline>
      <VisualMarkdownEditor
        v-if="detail.body"
        class="body"
        :content="detail.body"
        path=""
        :project-id="projectId"
        :editable="false"
        compact
      />
      <UiHint v-else size="xs" leading="inherit" :space-before="2">Без описания</UiHint>
      <ReleaseAssets :assets="detail.assets" />
    </UiArticle>
  </UiViewerPage>
</template>

<style scoped>
.state {
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
  font-size: var(--fs-2xs);
}
.tag {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.mono {
  font-family: var(--mono);
}
.meta {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.author {
  font-family: var(--mono);
  color: var(--text-2);
}
.external {
  color: var(--text-2);
}
.external svg {
  width: 13px;
  height: 13px;
}
.body {
  margin-top: var(--sp-3);
}
</style>
