<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import type { GithubRepository } from "../../../../core/modules/github/index.ts";
import { readRepository } from "../client.ts";
import GithubRepositoryInfo from "./GithubRepositoryInfo.vue";

const props = defineProps<{ repository: string; gitRef?: string }>();
const metadata = ref<GithubRepository>();
const error = ref("");
let request = 0;

async function load() {
  const current = ++request;
  metadata.value = undefined;
  error.value = "";
  if (!props.repository) {
    error.value = "origin проекта не указывает на GitHub";
    return;
  }
  try {
    const result = await readRepository(props.repository, props.gitRef ?? "");
    if (current === request) metadata.value = result;
  } catch (err) {
    if (current === request)
      error.value = err instanceof Error ? err.message : "Не удалось прочитать репозиторий";
  }
}
onMounted(load);
watch(() => [props.repository, props.gitRef] as const, load);
</script>

<template>
  <GithubRepositoryInfo v-if="metadata" :repository="metadata" :snapshot="false" />
  <p v-else class="msg" :role="error ? 'alert' : 'status'">
    {{ error || "загружаю репозиторий…" }}
  </p>
</template>

<style scoped>
.msg {
  padding: var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-xs);
}
.msg[role="alert"] {
  color: var(--err);
}
</style>
