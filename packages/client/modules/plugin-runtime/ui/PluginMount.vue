<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { deviceBase } from "../../../common/utilities/device-url.ts";
import { mountContribution } from "../store.ts";

const props = defineProps<{
  kind: "panel" | "tab";
  instance?: number;
  plugin: string;
  contributionId: string;
  projectId: string;
  params?: Record<string, unknown>;
  onCommand: (id: string, args?: unknown) => unknown;
  onOpenFile: (path: string, options?: { line?: number; column?: number }) => void;
  onOpenTab: (id: string, params?: Record<string, unknown>) => void;
}>();

const root = ref<HTMLElement>();
const error = ref("");
let controller: AbortController | undefined;
let dispose: (() => void) | undefined;

function stop() {
  controller?.abort();
  dispose?.();
  dispose = undefined;
}
function mount() {
  stop();
  error.value = "";
  const element = root.value;
  if (!element) return;
  controller = new AbortController();
  try {
    dispose = mountContribution(
      props.kind,
      props.plugin,
      props.contributionId,
      element,
      {
        projectId: props.projectId,
        device: deviceBase().split("/")[2] ?? "",
        signal: controller.signal,
        params: Object.freeze({ ...(props.params ?? {}) }),
        commands: {
          run: async (id: string, args?: unknown) => props.onCommand(id, args),
        },
        workspace: {
          openFile: (path: string, options?: { line?: number; column?: number }) =>
            props.onOpenFile(path, options),
          openTab: (id: string, params?: Record<string, unknown>) => props.onOpenTab(id, params),
        },
      },
      (message) => {
        error.value = message;
      },
    );
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "Не удалось открыть UI плагина";
  }
}
onMounted(mount);
watch(
  () => [
    props.instance,
    props.plugin,
    props.contributionId,
    props.projectId,
    JSON.stringify(props.params ?? {}),
  ],
  mount,
  { flush: "post" },
);
onBeforeUnmount(stop);
</script>

<template>
  <div class="plugin-contribution">
    <p v-if="error" class="plugin-contribution-error" role="alert">{{ error }}</p>
    <div ref="root" class="plugin-contribution-host" />
  </div>
</template>

<style scoped>
.plugin-contribution,
.plugin-contribution-host {
  min-width: 0;
  min-height: 0;
  height: 100%;
}
.plugin-contribution {
  overflow: auto;
}
.plugin-contribution-error {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--err);
  color: var(--err);
  font: var(--fs-xs) var(--sans);
}
</style>
