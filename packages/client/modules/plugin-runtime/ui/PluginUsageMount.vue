<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { commandHostKey } from "../../../common/utilities/commands.ts";
import { deviceBase } from "../../../common/utilities/device-url.ts";
import { mountAgentUsage } from "../mount.ts";

const props = defineProps<{
  agentId: string;
  title?: string;
  usageUrl?: string;
  packageName?: string;
  instance?: number;
  onSummary?: (remaining: number | null, tone: "spare" | "normal" | "hot" | "over" | null) => void;
}>();

const commandHost = inject(commandHostKey, undefined);
const commandScope = commandHost?.createScope(`pluginUsage:${useId()}`, () => ({
  surface: "statusBar",
  agent: props.agentId,
  plugin: props.packageName ?? "",
}));

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
    dispose = mountAgentUsage(
      props.agentId,
      element,
      {
        agentId: props.agentId,
        title: props.title ?? "",
        ...(props.usageUrl ? { usageUrl: props.usageUrl } : {}),
        device: deviceBase().split("/")[2] ?? "",
        signal: controller.signal,
        commands: {
          run: async (id: string, args?: unknown) => {
            if (!commandScope) return;
            commandScope.activate();
            return commandScope.executeCommand(id, args);
          },
        },
        publishSummary(
          remaining: number | null,
          tone: "spare" | "normal" | "hot" | "over" | null = null,
        ) {
          props.onSummary?.(remaining, tone);
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
watch(() => [props.instance, props.agentId, props.usageUrl, props.title], mount, { flush: "post" });
onBeforeUnmount(() => {
  stop();
  commandScope?.dispose();
});
</script>

<template>
  <div class="plugin-usage">
    <p v-if="error" class="plugin-usage-error" role="alert">{{ error }}</p>
    <div ref="root" class="plugin-usage-host" />
  </div>
</template>

<style scoped>
.plugin-usage,
.plugin-usage-host {
  min-width: 0;
  min-height: 0;
}
.plugin-usage-error {
  margin: 0;
  padding: var(--sp-1) var(--sp-2);
  color: var(--err);
  font: var(--fs-xs) var(--sans);
}
</style>
