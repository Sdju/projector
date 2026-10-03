<script setup lang="ts">
import { computed, onMounted, onUnmounted, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isLauncherWindow } from "../modules/launcher/index.ts";
import { useProjects, projectPathFromParams, projectIconUrl } from "../modules/project/index.ts";
import { useRunner } from "../modules/runner/index.ts";
import { CommandPalette, provideIdeCommands } from "../modules/ide/index.ts";
import AppShell from "./layouts/AppShell.vue";

const { error: commandError } = provideIdeCommands();
const { load, projects } = useProjects();
const { connect } = useRunner();
const route = useRoute();
const router = useRouter();
const currentProject = computed(() =>
  route.name === "project"
    ? projects.value.find(
        (project) => project.path === projectPathFromParams(route.params.projectPath),
      )
    : undefined,
);
watchEffect(() => {
  const project = currentProject.value;
  const page =
    route.name === "launcher"
      ? "поиск"
      : route.name === "home"
        ? "проекты"
        : route.name === "settings"
          ? "настройки"
          : "проект";
  document.title = project ? `${project.name} — Projector` : `Projector — ${page}`;
  const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (favicon) {
    // The project endpoint can return SVG, ICO, PNG or another image format.
    favicon.removeAttribute("type");
    favicon.href = project ? projectIconUrl(project) : "/favicon.svg";
  }
});
let blurTimer: ReturnType<typeof setTimeout> | undefined;
function cancelHide() {
  clearTimeout(blurTimer);
}
function windowBlur() {
  if (!isLauncherWindow || route.name !== "launcher") return;
  cancelHide();
  blurTimer = setTimeout(() => {
    if (route.name === "launcher" && !document.hasFocus()) {
      void fetch("/api/app/hide", { method: "POST" }).catch(() => undefined);
    }
  }, 100);
}
function showLauncher() {
  if (isLauncherWindow && route.name !== "launcher") void router.push("/");
}

onMounted(() => {
  connect();
  void load();
  window.addEventListener("projector:show", showLauncher);
  window.addEventListener("blur", windowBlur);
  window.addEventListener("focus", cancelHide);
});
onUnmounted(() => {
  cancelHide();
  window.removeEventListener("projector:show", showLauncher);
  window.removeEventListener("blur", windowBlur);
  window.removeEventListener("focus", cancelHide);
});
</script>

<template>
  <CommandPalette />
  <div v-if="commandError" class="command-error" role="alert">
    {{ commandError }}<button aria-label="Закрыть сообщение" @click="commandError = ''">×</button>
  </div>
  <router-view v-if="route.name === 'launcher'" />
  <AppShell v-else :current-project="currentProject">
    <router-view />
  </AppShell>
</template>

<style scoped>
.command-error {
  position: fixed;
  right: var(--sp-4);
  bottom: var(--sp-4);
  z-index: var(--z-popover);
  max-width: min(480px, calc(100vw - 32px));
  padding: var(--sp-3) var(--sp-4);
  background: var(--bg-2);
  border: 1px solid var(--err);
  color: var(--err);
  border-radius: var(--r-md);
  font-size: var(--fs-xs);
}
.command-error button {
  margin-left: var(--sp-4);
}
</style>
