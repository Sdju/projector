<script setup lang="ts">
import UiMessage from "../../../common/ui/UiMessage.vue";
import { onMounted, ref, watch } from "vue";
import type { GitlabRepository } from "../../../../core/modules/gitlab/index.ts";
import { readRepository } from "../client.ts";
import GitlabRepositoryInfo from "./GitlabRepositoryInfo.vue";

const props = defineProps<{ instance: string; path: string; gitRef?: string }>();
const metadata = ref<GitlabRepository>();
const error = ref("");
let request = 0;

async function load() {
  const current = ++request;
  metadata.value = undefined;
  error.value = "";
  if (!props.instance || !props.path) {
    error.value = "origin проекта не указывает на GitLab";
    return;
  }
  try {
    const result = await readRepository(`${props.instance}/${props.path}`, props.gitRef ?? "");
    if (current === request) metadata.value = result;
  } catch (err) {
    if (current === request)
      error.value = err instanceof Error ? err.message : "Не удалось прочитать проект";
  }
}
onMounted(load);
watch(() => [props.instance, props.path, props.gitRef] as const, load);
</script>

<template>
  <GitlabRepositoryInfo v-if="metadata" :repository="metadata" />
  <UiMessage
    size="xs"
    variant="padded"
    :tone="error ? 'danger' : 'muted'"
    :padding="4"
    v-else
    class="msg"
    :role="error ? 'alert' : 'status'"
  >
    {{ error || "загружаю проект…" }}
  </UiMessage>
</template>
