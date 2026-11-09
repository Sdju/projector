<script setup lang="ts">
import { GitlabWorkspaceGate } from "../../../modules/gitlab-workspace/index.ts";
import { useRoute, useRouter } from "vue-router";

const route = useRoute();
const router = useRouter();
const openSettings = () => void router.push({ path: "/settings", query: { section: "gitlab" } });
</script>

<template>
  <GitlabWorkspaceGate :raw-path="route.params.gitlabPath" @settings="openSettings" />
</template>
