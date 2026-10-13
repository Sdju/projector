<script setup lang="ts">
import UiCard from "../../../common/ui/UiCard.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { isEditTool } from "../lib/tool-input.ts";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import type { AgentPermission } from "../model/types.ts";
import IconShield from "~icons/lucide/shield-question";

defineProps<{ permissions: AgentPermission[] }>();
const emit = defineEmits<{ decide: [id: string, allow: boolean, always?: boolean] }>();
</script>

<template>
  <div
    v-if="permissions.length"
    class="permissions"
    role="alertdialog"
    aria-label="Запрос разрешения"
  >
    <UiCard
      v-for="item in permissions"
      :key="item.id"
      class="permission"
      tone="warning"
      density="notice"
    >
      <UiInline as="header" align="center" justify="normal">
        <IconShield aria-hidden="true" />
        <span class="title">{{ item.title }}</span>
        <code class="tool">{{ item.tool }}</code>
      </UiInline>
      <AgentCodeBlock v-if="item.detail" :text="item.detail" :diff="isEditTool(item.tool)" />
      <UiInline align="stretch">
        <UiButton appearance="solid" size="sm" @click="emit('decide', item.id, true)">
          Разрешить
        </UiButton>
        <UiButton
          v-if="item.persistent"
          size="sm"
          title="Разрешить и больше не спрашивать про этот инструмент"
          @click="emit('decide', item.id, true, true)"
        >
          Всегда разрешать
        </UiButton>
        <UiButton size="sm" @click="emit('decide', item.id, false)"> Отклонить </UiButton>
      </UiInline>
    </UiCard>
  </div>
</template>

<style scoped>
.permissions {
  display: grid;
  gap: 8px;
  margin: 0 0 10px;
}
header {
  min-width: 0;
}
header svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
}
.tool {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
}
</style>
