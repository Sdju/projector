<script setup lang="ts">
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiCard from "../../../common/ui/UiCard.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { judgeScoreTone } from "../../../../core/modules/agent-judge/index.ts";
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
        <span class="title" :title="item.title">{{ item.title }}</span>
        <code class="tool">{{ item.tool }}</code>
      </UiInline>
      <div v-if="item.judge" class="judge" role="note">
        <UiBadge :tone="judgeScoreTone(item.judge.score)">
          риск {{ item.judge.score }}/5 · {{ item.judge.label }}
        </UiBadge>
        <span class="judge-reason">
          {{ item.judge.reason
          }}<template v-if="item.judge.effect">. {{ item.judge.effect }}</template>
        </span>
      </div>
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
/* The title repeats the detail for a command: one line with a full text on hover, not a tall
   column that turns the card into half the screen. */
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.tool {
  flex-shrink: 0;
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
}
.judge {
  display: flex;
  align-items: baseline;
  gap: var(--sp-1);
  margin-bottom: var(--sp-2);
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.5;
}
.judge-reason {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
