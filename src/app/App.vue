<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { isLauncherWindow } from "../modules/launcher/index.ts";
import { useProjects } from "../modules/catalog/index.ts";
import { useRunner } from "../modules/runner/index.ts";
import { CommandPalette, provideIdeCommands } from "../modules/ide/index.ts";
import AppShell from "./layouts/AppShell.vue";

const { error: commandError } = provideIdeCommands();
const { load } = useProjects();
const { connect } = useRunner();
const route = useRoute();
const router = useRouter();
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
  <AppShell v-else>
    <router-view />
  </AppShell>
</template>

<style scoped>
.command-error {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 1000;
  max-width: min(480px, calc(100vw - 32px));
  padding: 12px 16px;
  background: var(--bg-2);
  border: 1px solid var(--err);
  color: var(--err);
  border-radius: 6px;
  font-size: 12px;
}
.command-error button {
  margin-left: 16px;
}
</style>
