<script setup lang="ts">
import { computed } from "vue";
import { CloneRepositoryDialog } from "../integration-api/index.ts";
import { formatProjectRef } from "../project/index.ts";

const props = defineProps<{
  /** Canonical `<instance>/<group>/<project>` form sent to the API. */
  repository: string;
  /** Full project path without the instance; also the destination suffix. */
  path: string;
  navigate: (path: string) => Promise<void>;
}>();
const instance = computed(() =>
  props.repository.endsWith(`/${props.path}`)
    ? props.repository.slice(0, props.repository.length - props.path.length - 1)
    : props.repository,
);
const projectId = computed(() =>
  formatProjectRef({ kind: "gitlab", instance: instance.value, path: props.path }),
);
</script>

<template>
  <CloneRepositoryDialog
    source="gitlab"
    :repository="repository"
    :destination-name="path"
    :project-id="projectId"
    :navigate="navigate"
  />
</template>
