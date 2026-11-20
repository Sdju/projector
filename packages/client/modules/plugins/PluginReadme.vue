<script setup lang="ts">
import { pluginReadmePath } from "@ai-projector/core/modules/plugins/index.ts";
import { ref, watch } from "vue";
import UiEmpty from "../../common/ui/UiEmpty.vue";
import UiLoader from "../../common/ui/UiLoader.vue";
import UiMessage from "../../common/ui/UiMessage.vue";
import { deviceUrl } from "../../common/utilities/device-url.ts";
import { markdownPath } from "../../common/utilities/markdown-path.ts";
import { MarkdownView } from "../markdown/index.ts";
import { fetchPluginReadme, type PluginInfo } from "./client.ts";

const props = defineProps<{ plugin: PluginInfo }>();
const text = ref("");
const busy = ref(false);
const error = ref("");
const missing = ref(false);

function resolveImage(src: string) {
  const relative = markdownPath(src, "README.md");
  if (relative) {
    try {
      return deviceUrl(pluginReadmePath(props.plugin.id, relative));
    } catch {
      return;
    }
  }
  if (/^(?:https?:)?\/\//i.test(src)) return src;
}

async function load(id: string, hasReadme: boolean) {
  text.value = "";
  error.value = "";
  missing.value = !hasReadme;
  if (!hasReadme) return;
  busy.value = true;
  try {
    const markdown = await fetchPluginReadme(id);
    if (id !== props.plugin.id) return;
    if (markdown === null) missing.value = true;
    else text.value = markdown;
  } catch (reason) {
    if (id !== props.plugin.id) return;
    error.value = reason instanceof Error ? reason.message : "Не удалось прочитать README";
  } finally {
    if (id === props.plugin.id) busy.value = false;
  }
}

watch(
  () => [props.plugin.id, props.plugin.readme === true] as const,
  ([id, hasReadme]) => void load(id, hasReadme),
  { immediate: true },
);
</script>

<template>
  <UiLoader v-if="busy" :padding="3">Загрузка README…</UiLoader>
  <UiMessage v-else-if="error" tone="danger" size="xs" wrap>{{ error }}</UiMessage>
  <UiEmpty v-else-if="missing" density="compact" align="start">
    Пакет не содержит README.md в корне.
  </UiEmpty>
  <div v-else class="plugin-readme">
    <MarkdownView :text="text" :resolve-image="resolveImage" />
  </div>
</template>
