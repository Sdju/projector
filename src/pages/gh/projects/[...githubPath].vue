<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { githubRepositoryFromParams } from "../../../modules/project/index.ts";
import { GithubWorkspace } from "../../../modules/github-workspace/index.ts";
const route = useRoute();
const repository = computed(() => githubRepositoryFromParams(route.params.githubPath));
</script>
<template>
  <section class="project-page">
    <GithubWorkspace :key="repository" :repository="repository" />
  </section>
</template>
