<script setup lang="ts">
import UiAsyncContent from "../../../common/ui/UiAsyncContent.vue";
import type { GithubRepository } from "@projector-ai/core/modules/github/index.ts";
import { readRepository } from "../client.ts";
import GithubRepositoryInfo from "./GithubRepositoryInfo.vue";

const props = defineProps<{ repository: string; gitRef?: string }>();
const load = async (): Promise<GithubRepository> => {
  if (!props.repository) throw new Error("origin проекта не указывает на GitHub");
  return readRepository(props.repository, props.gitRef ?? "");
};
const keys = () => [props.repository, props.gitRef] as const;
</script>

<template>
  <UiAsyncContent
    :load="load"
    :watch-keys="keys"
    error-text="Не удалось прочитать репозиторий"
    loading-text="загружаю репозиторий…"
  >
    <template #default="{ data }">
      <GithubRepositoryInfo :repository="data" :snapshot="false" />
    </template>
  </UiAsyncContent>
</template>
