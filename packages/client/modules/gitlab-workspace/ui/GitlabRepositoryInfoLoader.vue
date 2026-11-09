<script setup lang="ts">
import UiAsyncContent from "../../../common/ui/UiAsyncContent.vue";
import type { GitlabRepository } from "@projector/core/modules/gitlab/index.ts";
import { readRepository } from "../client.ts";
import GitlabRepositoryInfo from "./GitlabRepositoryInfo.vue";

const props = defineProps<{ instance: string; path: string; gitRef?: string }>();
const load = async (): Promise<GitlabRepository> => {
  if (!props.instance || !props.path) throw new Error("origin проекта не указывает на GitLab");
  return readRepository(`${props.instance}/${props.path}`, props.gitRef ?? "");
};
const keys = () => [props.instance, props.path, props.gitRef] as const;
</script>

<template>
  <UiAsyncContent
    :load="load"
    :watch-keys="keys"
    error-text="Не удалось прочитать проект"
    loading-text="загружаю проект…"
  >
    <template #default="{ data }">
      <GitlabRepositoryInfo :repository="data" />
    </template>
  </UiAsyncContent>
</template>
