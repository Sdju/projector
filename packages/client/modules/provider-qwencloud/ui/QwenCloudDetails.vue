<script setup lang="ts">
import { computed } from "vue";
import { qwenCloudEndpointOrNull } from "@ai-projector/core/modules/providers/index.ts";
import UiInline from "../../../common/ui/UiInline.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import type { OpenAIProviderPublic } from "../../provider/index.ts";

const props = defineProps<{ provider: OpenAIProviderPublic }>();
const endpoint = computed(() => qwenCloudEndpointOrNull(props.provider.url));
</script>

<template>
  <div class="details">
    <UiInline v-if="endpoint" wrap :gap="2">
      <span class="meta">регион</span>
      <strong>{{ endpoint.region || "не указан в адресе" }}</strong>
      <code>{{ endpoint.openAiBase }}</code>
    </UiInline>
    <UiMessage v-if="endpoint?.legacy" tone="warning" size="xs" flush>
      Это старый домен DashScope. Ключи и регионы QwenCloud с ним не совпадают: используйте
      https://{region}.maas.qwencloudapi.com/compatible-mode/v1.
    </UiMessage>
    <UiMessage v-else-if="provider.url.trim() && !endpoint" tone="warning" size="xs" flush>
      Адрес не разобран: укажите https://{region}.maas.qwencloudapi.com/compatible-mode/v1.
    </UiMessage>
  </div>
</template>

<style scoped>
.details {
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
}
.meta {
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-xs);
}
</style>
