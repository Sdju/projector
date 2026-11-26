<script setup lang="ts">
import UiInline from "../../../common/ui/UiInline.vue";
import { ref } from "vue";
import type { JudgeOverride } from "@ai-projector/core/modules/agent-judge/index.ts";
import { AgentFeaturesIsland } from "../../agent-features/index.ts";
import { AgentJudgeIsland } from "../modules/settings/index.ts";
import AgentChatMenu from "./AgentChatMenu.vue";

defineProps<{
  zen: boolean;
  lens: boolean;
  side: boolean;
  canDownload: boolean;
  canIsolate: boolean;
  backend: string;
  chat: string;
  loading: boolean;
  featureOverrides?: string[];
  judgeOverride?: JudgeOverride;
}>();
const isolate = defineModel<boolean>("isolate", { required: true });
const emit = defineEmits<{
  lens: [];
  side: [];
  download: [];
  "update:featureOverrides": [overrides: string[] | undefined];
  "update:judgeOverride": [override: JudgeOverride | undefined];
}>();
const chatMenu = ref<InstanceType<typeof AgentChatMenu>>();
const featuresIsland = ref<InstanceType<typeof AgentFeaturesIsland>>();
const judgeIsland = ref<InstanceType<typeof AgentJudgeIsland>>();
</script>

<template>
  <UiInline v-show="!zen" :inert="zen" class="chat-tools" :gap="1" align="normal" justify="end">
    <slot />
    <AgentChatMenu
      ref="chatMenu"
      :lens="lens"
      :side="side"
      :can-download="canDownload"
      :can-isolate="canIsolate"
      :isolate="isolate"
      :features-changed="featureOverrides !== undefined"
      :judge-changed="judgeOverride !== undefined"
      @features="featuresIsland?.openAt(chatMenu?.anchor())"
      @judge="judgeIsland?.openAt(chatMenu?.anchor())"
      @lens="emit('lens')"
      @side="emit('side')"
      @download="emit('download')"
      @isolate="isolate = !isolate"
    />
  </UiInline>
  <AgentFeaturesIsland
    ref="featuresIsland"
    :show-trigger="false"
    :anchor="() => chatMenu?.anchor()"
    :backend="backend"
    :chat="chat"
    :overrides="featureOverrides"
    :disabled="loading"
    @update:overrides="emit('update:featureOverrides', $event)"
  />
  <AgentJudgeIsland
    ref="judgeIsland"
    :show-trigger="false"
    :anchor="() => chatMenu?.anchor()"
    :chat="chat"
    :override="judgeOverride"
    :disabled="loading"
    @update:override="emit('update:judgeOverride', $event)"
  />
</template>

<style scoped>
.chat-tools {
  flex: none;
  width: 100%;
  max-width: calc(var(--chat-width) + 56px);
  margin: 0 auto;
  padding: var(--sp-2) var(--sp-5) 0;
}
</style>
