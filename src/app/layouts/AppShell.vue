<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { PathBar, useProjects } from "../../modules/catalog/index.ts";

const { projects, save } = useProjects();
const route = useRoute();
const running = computed(
  () => projects.value.filter((item) => item.runtime?.status === "running").length,
);

const currentProject = computed(() =>
  route.name === "project"
    ? projects.value.find((project) => project.id === String(route.params.id))
    : undefined,
);
async function navigatePath(path: string) {
  if (currentProject.value && currentProject.value.path !== path)
    await save(currentProject.value.id, { path });
}

</script>

<template>
  <div
    class="shell"
    :class="{ workspace: route.name === 'project' }"
    @dragover.prevent
    @drop.prevent
  >
    <header class="top">
      <router-link class="brand" to="/">projector</router-link>
      <PathBar
        v-if="currentProject"
        :key="currentProject.id"
        class="header-path"
        :path="currentProject.path"
        :navigate="navigatePath"
      />
      <nav class="nav">
        <router-link to="/projects">проекты</router-link>
        <router-link to="/settings">настройки</router-link>
        <span class="count">{{ running }}</span>
      </nav>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  width: min(760px, calc(100% - 32px));
  margin: 0 auto;
  padding: 18px 0 56px;
  min-height: 100%;
  position: relative;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 18px;
}

.header-path {
  flex: 1;
}

.brand {
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: lowercase;
  color: var(--muted);
}

.nav {
  flex-shrink: 0;
  display: flex;
  gap: 12px;
  align-items: baseline;
}

.nav a,
.count {
  color: var(--faint);
  font-size: 12px;
}

.nav a.router-link-active {
  color: var(--muted);
}

.shell.workspace {
  width: calc(100% - 32px);
  max-width: 2400px;
  padding-bottom: 16px;
}
@media (max-width: 600px) {
  .top {
    gap: 8px;
  }
  .nav {
    gap: 7px;
  }
  .brand {
    letter-spacing: 0.06em;
  }
}
</style>
