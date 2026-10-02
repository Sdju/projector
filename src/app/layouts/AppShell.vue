<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  PathBar,
  useProjects,
  projectRoute,
  projectIconUrl,
  type Project,
} from "../../modules/catalog/index.ts";

defineProps<{ currentProject?: Project }>();
const { projects } = useProjects();
const route = useRoute();
const router = useRouter();
const running = computed(
  () => projects.value.filter((item) => item.runtime?.status === "running").length,
);

async function navigatePath(path: string) {
  await router.push(projectRoute(path));
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
      <router-link
        class="brand"
        :class="{ 'project-brand': currentProject }"
        to="/"
        :title="currentProject ? `${currentProject.name} — открыть поиск` : 'Открыть поиск'"
      >
        <img
          v-if="currentProject"
          :src="projectIconUrl(currentProject)"
          alt=""
          width="22"
          height="22"
        />
        <span>{{ currentProject?.name ?? "projector" }}</span>
      </router-link>
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
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  font-size: 12px;
  letter-spacing: 0.16em;
  text-transform: lowercase;
  color: var(--muted);
}

.brand.project-brand {
  flex-shrink: 1;
  min-width: 0;
  max-width: min(30vw, 320px);
  font-size: 14px;
  letter-spacing: normal;
  text-transform: none;
  color: var(--text);
}

.brand span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.brand img {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: 4px;
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
