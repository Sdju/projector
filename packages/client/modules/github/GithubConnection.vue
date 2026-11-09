<script setup lang="ts">
import { computed } from "vue";
import { TokenConnectionForm } from "../integration-api/index.ts";
import { formatProjectRef } from "../project/index.ts";
import { connectGithubToken } from "./connect.ts";

const props = defineProps<{ repository: string }>();
const emit = defineEmits<{ connected: [] }>();
const projectId = computed(() =>
  formatProjectRef({ kind: "github", repository: props.repository }),
);
async function connect(token: string) {
  await connectGithubToken(token);
}
</script>

<template>
  <TokenConnectionForm
    host="GitHub"
    subject-label="Репозиторий"
    :subject="repository"
    :project-id="projectId"
    :scope-key="`github-connection:${repository}`"
    surface="github-integration"
    placeholder="github_pat_…"
    token-url="https://github.com/settings/tokens"
    command-id="ide.github.integration.connect"
    command-description="Подключает GitHub с токеном, введённым в форме интеграции, и открывает репозиторий."
    readout-note="Подключение к GitHub"
    :connect="connect"
    @connected="emit('connected')"
  />
</template>
