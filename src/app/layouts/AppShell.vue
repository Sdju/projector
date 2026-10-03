<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProjects, projectRoute, projectIconUrl, type Project } from "../../modules/project/index.ts";
import { PathBar } from "../../modules/catalog/index.ts";

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
        <span
          class="count"
          :class="{ active: running }"
          :title="`Запущено проектов: ${running}`"
          :aria-label="`Запущено проектов: ${running}`"
          role="status"
          ><span class="count-dot" aria-hidden="true" />{{ running }}</span
        >
      </nav>
    </header>
    <main>
      <slot />
    </main>
  </div>
</template>

<style scoped>
.shell {
  --page-width: 760px;
  --brand-track: 0.16em;
  width: min(var(--page-width), calc(100% - var(--sp-4) * 2));
  margin: 0 auto;
  padding: var(--sp-4) 0 56px;
  min-height: 100%;
  position: relative;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--sp-3);
  gap: var(--sp-4);
}

.header-path {
  flex: 1;
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  flex-shrink: 0;
  font-size: var(--fs-xs);
  letter-spacing: var(--brand-track);
  text-transform: lowercase;
  color: var(--muted);
}

.brand.project-brand {
  flex-shrink: 1;
  min-width: 0;
  max-width: min(30vw, 320px);
  font-size: var(--fs-sm);
  letter-spacing: 0;
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
  border-radius: var(--r-sm);
}

.nav {
  flex-shrink: 0;
  display: flex;
  gap: var(--sp-3);
  align-items: center;
}

.nav a,
.count {
  color: var(--muted);
  font-size: var(--fs-xs);
}

.nav a:hover {
  color: var(--text);
}

.nav a.router-link-active {
  color: var(--text);
}

.count {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}

.count-dot {
  width: 6px;
  height: 6px;
  border-radius: var(--r-full);
  background: var(--faint);
}

.count.active .count-dot {
  background: var(--run);
}

.shell.workspace {
  width: calc(100% - var(--sp-4) * 2);
  max-width: 2400px;
  padding-bottom: var(--sp-4);
}
@media (max-width: 600px) {
  .top {
    gap: var(--sp-2);
  }
  .nav {
    gap: var(--sp-2);
  }
  .brand {
    --brand-track: 0.06em;
  }
}
</style>
