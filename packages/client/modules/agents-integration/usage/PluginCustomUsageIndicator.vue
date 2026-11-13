<script setup lang="ts">
import { ref } from "vue";
import { PluginUsageMount } from "../../plugin-runtime/index.ts";
import { publishAgentUsage } from "../_/usage-summary.ts";
import type { UsagePaceTone } from "../_/usage-pace.ts";

const props = defineProps<{
  agentId: string;
  title?: string;
  usageUrl?: string;
  packageName?: string;
  instance?: number;
}>();

const remainingRef = ref<number | null>(null);
const toneRef = ref<UsagePaceTone | null>(null);
publishAgentUsage(props.agentId, remainingRef, toneRef);

function onSummary(remaining: number | null, tone: UsagePaceTone | null) {
  remainingRef.value = remaining;
  toneRef.value = tone;
}
</script>

<template>
  <PluginUsageMount
    :agent-id="props.agentId"
    :title="props.title"
    :usage-url="props.usageUrl"
    :package-name="props.packageName"
    :instance="props.instance"
    :on-summary="onSummary"
  />
</template>
