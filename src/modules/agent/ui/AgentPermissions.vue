<script setup lang="ts">
import UiCard from "../../../common/ui/UiCard.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import {
  canRememberPermission,
  permissionRiskClass,
  permissionTone,
} from "../lib/permission-risk.ts";
import { isEditTool } from "../lib/tool-input.ts";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import type { AgentPermission } from "../model/types.ts";
import IconShield from "~icons/lucide/shield";
import IconShieldAlert from "~icons/lucide/shield-alert";
import IconShieldCheck from "~icons/lucide/shield-check";
import IconShieldX from "~icons/lucide/shield-x";

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
      :class="permissionRiskClass(item.judge)"
      :tone="permissionTone(item.judge)"
      density="notice"
    >
      <div class="head">
        <div
          class="risk-box"
          :class="permissionRiskClass(item.judge)"
          :aria-label="
            item.judge
              ? `Риск ${item.judge.score} из 5: ${item.judge.label}`
              : 'Оценка риска недоступна'
          "
          :title="item.judge ? `Риск ${item.judge.score}/5 · ${item.judge.label}` : undefined"
        >
          <IconShieldCheck v-if="item.judge && item.judge.score <= 2" aria-hidden="true" />
          <IconShieldAlert v-else-if="item.judge && item.judge.score === 3" aria-hidden="true" />
          <IconShieldX v-else-if="item.judge" aria-hidden="true" />
          <IconShield v-else aria-hidden="true" />
          <span v-if="item.judge" class="risk-score">{{ item.judge.score }}/5</span>
        </div>
        <div class="head-text">
          <div class="title-row">
            <span class="title" :title="item.title">{{ item.title }}</span>
            <code class="tool">{{ item.tool }}</code>
          </div>
          <div v-if="item.judge" class="judge-copy" role="note">
            <p>
              <span class="judge-label">Почему</span>
              {{ item.judge.reason }}
            </p>
            <p v-if="item.judge.effect">
              <span class="judge-label">Что изменится</span>
              {{ item.judge.effect }}
            </p>
          </div>
        </div>
      </div>
      <AgentCodeBlock
        v-if="item.detail"
        class="command"
        :text="item.detail"
        :diff="isEditTool(item.tool)"
      />
      <UiInline align="stretch">
        <UiButton appearance="solid" size="sm" @click="emit('decide', item.id, true)">
          Разрешить
        </UiButton>
        <UiButton
          v-if="canRememberPermission(item)"
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
.permission {
  position: relative;
}
.head {
  display: flex;
  align-items: flex-start;
  gap: var(--sp-2);
}
.risk-box {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
  border: 1px solid transparent;
  border-radius: var(--r-md);
  gap: 2px;
}
.risk-box svg {
  width: 24px;
  height: 24px;
}
.risk-score {
  font: 600 11px/1 var(--mono);
  letter-spacing: 0.02em;
}
.risk-box.risk-1 {
  color: var(--run);
  background: color-mix(in srgb, var(--run) 16%, var(--bg-2));
  border-color: color-mix(in srgb, var(--run) 40%, var(--line));
}
.risk-box.risk-2 {
  color: var(--info);
  background: color-mix(in srgb, var(--info) 15%, var(--bg-2));
  border-color: color-mix(in srgb, var(--info) 40%, var(--line));
}
.risk-box.risk-3 {
  color: var(--warn);
  background: color-mix(in srgb, var(--warn) 16%, var(--bg-2));
  border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
}
.risk-box.risk-4,
.risk-box.risk-5 {
  color: var(--err);
  background: color-mix(in srgb, var(--err) 16%, var(--bg-2));
  border-color: color-mix(in srgb, var(--err) 45%, var(--line));
}
.head-text {
  display: grid;
  min-width: 0;
  gap: var(--sp-1);
}
.title-row {
  display: flex;
  align-items: center;
  min-width: 0;
  padding-right: 64px;
  gap: var(--sp-2);
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
  font-size: var(--fs-sm);
}
.tool {
  position: absolute;
  top: 10px;
  right: 12px;
  color: var(--muted);
  font-family: var(--mono);
}
.judge-copy {
  display: grid;
  gap: 2px;
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.judge-copy p {
  margin: 0;
  overflow-wrap: anywhere;
}
.judge-label {
  color: var(--text-2);
  font-weight: 600;
}
.permission :deep(.code) {
  background: var(--bg-sunken);
}
.permission.risk-1 {
  background: color-mix(in srgb, var(--run) 7%, var(--bg-2));
  border-color: color-mix(in srgb, var(--run) 32%, var(--bg-2));
}
.permission.risk-2 {
  background: color-mix(in srgb, var(--info) 7%, var(--bg-2));
  border-color: color-mix(in srgb, var(--info) 32%, var(--bg-2));
}
</style>
