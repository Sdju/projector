<script setup lang="ts">
import { computed } from "vue";
import { CloneRepositoryDialog } from "../integration-api/index.ts";

const props = defineProps<{ repository: string; navigate: (path: string) => Promise<void> }>();
const projectId = computed(() => `gh:/${props.repository}`);
const destinationName = computed(() => props.repository.split("/").pop() ?? "");
</script>

<template>
  <CloneRepositoryDialog
    source="github"
    :repository="repository"
    :destination-name="destinationName"
    :project-id="projectId"
    :navigate="navigate"
  />
</template>
