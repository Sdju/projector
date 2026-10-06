<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import SplitPanes from "./SplitPanes.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import IconRefresh from "~icons/lucide/refresh-cw";
import IconExternal from "~icons/lucide/external-link";
import IconPage from "~icons/lucide/eye";
import IconSplit from "~icons/lucide/columns-2";
import IconCode from "~icons/lucide/code";
const CodeViewer = defineAsyncComponent(() => import("./CodeViewer.vue"));
type Mode = "page" | "split" | "source";
const props = defineProps<{
  path: string;
  content: string;
  /** Сохранённая версия: iframe читает файл с диска, поэтому обновляется по ней. */
  saved: string;
  siteUrl: string;
  mode: Mode;
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
const modes: { id: Mode; label: string; icon: unknown }[] = [
  { id: "page", label: "Только страница", icon: IconPage },
  { id: "split", label: "Страница и код", icon: IconSplit },
  { id: "source", label: "Только код", icon: IconCode },
];
</script>

<template>
  <section class="html-viewer" aria-label="Просмотр HTML">
    <div class="toolbar">
      <div class="modes" role="group" aria-label="Режим просмотра HTML">
        <UiButton
          v-for="item in modes"
          :key="item.id"
          icon
          size="sm"
          :aria-pressed="mode === item.id"
          :aria-label="item.label"
          :title="item.label"
          @click="emit('command', 'ide.editor.html.setMode', { mode: item.id })"
        >
          <component :is="item.icon" aria-hidden="true" />
        </UiButton>
      </div>
      <label
        >Ширина
        <select v-model="width" aria-label="Ширина страницы">
          <option v-for="item in widths" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select></label
      >
      <span class="url" :title="siteUrl">{{ siteUrl }}</span>
      <UiButton
        icon
        size="sm"
        aria-label="Перезагрузить страницу"
        title="Перезагрузить страницу"
        @click="emit('command', 'ide.editor.html.reload')"
      >
        <IconRefresh aria-hidden="true" />
      </UiButton>
      <UiButton
        icon
        size="sm"
        aria-label="Открыть в браузере"
        title="Открыть страницу в новой вкладке браузера"
        @click="emit('command', 'ide.editor.html.openInBrowser')"
      >
        <IconExternal aria-hidden="true" />
      </UiButton>
    </div>
    <SplitPanes v-if="mode === 'split'" top-label="Страница" bottom-label="Код" :reveal="line">
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
    <div v-else-if="mode === 'page'" class="page-pane">
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
    <div v-else class="source-pane">
      <CodeViewer
        :path="path"
        :content="content"
        :editable="editable"
        :line="line"
        :column="column"
        @change="emit('change', $event)"
        @save="emit('save')"
      />
    </div>
  </section>
</template>

<style scoped>
.html-viewer {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.toolbar {
  display: flex;
  align-items: center;
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
.modes {
  display: flex;
  gap: 2px;
}
.modes [aria-pressed="true"] {
  background: var(--bg-4);
}
.url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
.source-pane {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
</style>
