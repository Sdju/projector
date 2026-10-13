<script setup lang="ts">
import UiControl from "../../../../../common/ui/UiControl.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";
import UiPanel from "../../../../../common/ui/UiPanel.vue";
import UiToolbar from "../../../../../common/ui/UiToolbar.vue";
import { computed, defineAsyncComponent, ref, watch } from "vue";
import SplitPanes from "./SplitPanes.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconExternal from "~icons/lucide/external-link";
import IconPanel from "~icons/lucide/app-window";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
const props = defineProps<{
  path: string;
  content: string;
  /** Сохранённая версия: iframe читает файл с диска, поэтому обновляется по ней. */
  saved: string;
  siteUrl: string;
  reload?: number;
  editable?: boolean;
  line?: number;
  column?: number;
}>();
const emit = defineEmits<{
  change: [content: string];
  save: [];
  command: [id: string, args?: unknown];
}>();
const widths = [
  { id: "auto", label: "Авто", width: "" },
  { id: "mobile", label: "Телефон · 375", width: "375px" },
  { id: "tablet", label: "Планшет · 768", width: "768px" },
  { id: "desktop", label: "Ноутбук · 1280", width: "1280px" },
];
const width = ref("auto");
const loads = ref(0);
// A saved edit or a manual reload both re-request the document and its resources.
watch(
  () => [props.saved, props.reload],
  () => loads.value++,
);
const frameStyle = computed(() => {
  const value = widths.find((item) => item.id === width.value)?.width;
  return value ? { width: value, maxWidth: "100%" } : undefined;
});
</script>

<template>
  <UiPanel class="html-viewer" aria-label="Просмотр HTML">
    <UiToolbar class="toolbar" :column-gap="4" text="xs">
      <UiInline as="label" :gap="1.5" justify="normal"
        >Ширина
        <UiControl
          as="select"
          v-model="width"
          appearance="inline-select"
          aria-label="Ширина страницы"
        >
          <option v-for="item in widths" :key="item.id" :value="item.id">{{ item.label }}</option>
        </UiControl></UiInline
      >
      <span class="url u-truncate" :title="siteUrl">{{ siteUrl }}</span>
      <UiButton
        shape="icon"
        size="sm"
        aria-label="Перезагрузить страницу"
        title="Перезагрузить страницу"
        @click="emit('command', 'ide.editor.html.reload')"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        aria-label="Открыть во вкладке браузера"
        title="Открыть страницу во вкладке браузера Projector"
        @click="emit('command', 'ide.editor.html.openInBrowserTab')"
      >
        <IconPanel aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        aria-label="Открыть в браузере"
        title="Открыть страницу в новой вкладке браузера"
        @click="emit('command', 'ide.editor.html.openInBrowser')"
      >
        <IconExternal aria-hidden="true" />
      </UiButton>
    </UiToolbar>
    <SplitPanes top-label="Страница" bottom-label="Код" :reveal="line">
      <template #top>
        <div class="page-pane">
          <!-- No allow-same-origin: the document gets an opaque origin and cannot reach the Projector API. -->
          <iframe
            :key="loads"
            class="page-frame"
            :style="frameStyle"
            :src="siteUrl"
            :title="`Страница ${path}`"
            sandbox="allow-scripts allow-forms allow-popups allow-modals"
            referrerpolicy="no-referrer"
          ></iframe>
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
  </UiPanel>
</template>

<style scoped>
.url {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  color: var(--muted);
}
.page-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  justify-content: center;
  overflow: auto;
  background: var(--bg-3);
}
.page-frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #fff;
  color-scheme: normal;
}
</style>
