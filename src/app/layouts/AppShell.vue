<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useProjects, projectRoute, projectIconUrl, type Project } from "../../modules/project/index.ts";
import { PathBar, MobileProjectPicker } from "../../modules/catalog/index.ts";

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
    <header class="top" :class="{ 'has-project': currentProject }">
      <MobileProjectPicker v-if="currentProject" :key="currentProject.id" class="mobile-picker" :project="currentProject" />
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
.mobile-picker { display: none; }

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
@media (max-width: 700px), (max-width: 1050px) and (max-height: 500px) and (pointer: coarse) {
  .shell,
  .shell.workspace {
    width: auto;
    margin-inline: max(var(--sp-2), env(safe-area-inset-left)) max(var(--sp-2), env(safe-area-inset-right));
    padding-top: max(var(--sp-2), env(safe-area-inset-top));
    padding-bottom: max(var(--sp-3), env(safe-area-inset-bottom));
  }
  .top {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--sp-2);
    margin-bottom: var(--sp-2);
  }
  .brand,
  .brand.project-brand {
    max-width: none;
    min-width: 0;
    min-height: 44px;
    --brand-track: 0.06em;
  }
  .nav {
    grid-column: 2;
    grid-row: 1;
    gap: var(--sp-3);
  }
  .nav a {
    display: flex;
    align-items: center;
    min-height: 44px;
  }
  .top.has-project { display: flex; margin-bottom: 0; }
  .has-project .brand, .has-project .header-path, .has-project .nav { display: none; }
  .mobile-picker { display: block; }
  .shell.workspace { margin-inline: 0; padding: env(safe-area-inset-top) 0 env(safe-area-inset-bottom); height: 100dvh; display: flex; flex-direction: column; }
  .workspace main { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .workspace main :deep(.project-page) { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .header-path {
    grid-column: 1 / -1;
    height: 44px;
  }
}
</style>
