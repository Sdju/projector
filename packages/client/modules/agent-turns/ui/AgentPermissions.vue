<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { canRememberPermission, permissionRiskClass } from "../lib/permission-risk.ts";
import { isEditTool } from "../../agent-core/index.ts";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import type { AgentPermission } from "../../agent-core/index.ts";

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
    <section
      v-for="item in permissions"
      :key="item.id"
      class="permission"
      :class="permissionRiskClass(item.judge)"
    >
      <div class="head">
        <span
          class="risk"
          :class="permissionRiskClass(item.judge)"
          :title="
            item.judge
              ? `Риск ${item.judge.score}/5 · ${item.judge.label}`
              : 'Оценка риска недоступна'
          "
        >
          <ProjectorIcon
            name="shield-check"
            v-if="item.judge && item.judge.score <= 2"
            aria-hidden="true"
          />
          <ProjectorIcon
            name="shield-alert"
            v-else-if="item.judge && item.judge.score === 3"
            aria-hidden="true"
          />
          <ProjectorIcon name="shield-x" v-else-if="item.judge" aria-hidden="true" />
          <ProjectorIcon name="shield" v-else aria-hidden="true" />
          <span v-if="item.judge" class="risk-score">{{ item.judge.score }}/5</span>
        </span>
        <span class="title" :title="item.title">{{ item.title }}</span>
        <code v-if="item.tool" class="tool" :title="item.tool">{{ item.tool }}</code>
      </div>
      <div v-if="item.judge" class="judge-copy" role="note">
        <p>{{ item.judge.reason }}</p>
        <p v-if="item.judge.effect" class="effect">
          <span aria-hidden="true">→</span> {{ item.judge.effect }}
        </p>
      </div>
      <AgentCodeBlock
        v-if="item.detail"
        class="command"
        :text="item.detail"
        :diff="isEditTool(item.tool)"
      />
      <div class="actions">
        <UiButton
          shape="icon"
          size="sm"
          appearance="quiet"
          tone="danger"
          title="Отклонить"
          aria-label="Отклонить"
          @click="emit('decide', item.id, false)"
        >
          <ProjectorIcon name="x" aria-hidden="true" />
        </UiButton>
        <UiButton
          v-if="canRememberPermission(item)"
          shape="icon"
          size="sm"
          appearance="quiet"
          title="Разрешить и больше не спрашивать про этот инструмент"
          aria-label="Разрешить и больше не спрашивать"
          @click="emit('decide', item.id, true, true)"
        >
          <ProjectorIcon name="check-check" aria-hidden="true" />
        </UiButton>
        <UiButton
          shape="icon"
          size="sm"
          appearance="solid"
          title="Разрешить"
          aria-label="Разрешить"
          @click="emit('decide', item.id, true)"
        >
          <ProjectorIcon name="check" aria-hidden="true" />
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.permissions {
  display: grid;
  gap: 8px;
}
.permission {
  display: grid;
  gap: 8px;
  padding: 10px 12px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--theme-inset-background, var(--bg-2));
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.permission.risk-1 {
  background: color-mix(in srgb, var(--run) 7%, var(--theme-inset-background, var(--bg-2)));
  border-color: color-mix(in srgb, var(--run) 32%, var(--line));
}
.permission.risk-2 {
  background: color-mix(in srgb, var(--info) 7%, var(--theme-inset-background, var(--bg-2)));
  border-color: color-mix(in srgb, var(--info) 32%, var(--line));
}
.permission.risk-3 {
  background: color-mix(in srgb, var(--warn) 8%, var(--theme-inset-background, var(--bg-2)));
  border-color: color-mix(in srgb, var(--warn) 40%, var(--line));
}
.permission.risk-4,
.permission.risk-5 {
  background: color-mix(in srgb, var(--err) 8%, var(--theme-inset-background, var(--bg-2)));
  border-color: color-mix(in srgb, var(--err) 48%, var(--line));
}
.head {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 7px;
}
.risk {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}
.risk svg {
  width: 14px;
  height: 14px;
}
.risk-score {
  font: 600 10px/1 var(--mono);
}
.risk.risk-1 {
  color: var(--run);
}
.risk.risk-2 {
  color: var(--info);
}
.risk.risk-3 {
  color: var(--warn);
}
.risk.risk-4,
.risk.risk-5 {
  color: var(--err);
}
.title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
.tool {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  margin-left: auto;
  color: var(--faint);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.judge-copy {
  display: grid;
  gap: 2px;
  color: var(--muted);
  line-height: 1.45;
}
.judge-copy p {
  margin: 0;
  overflow-wrap: anywhere;
}
.effect {
  color: var(--text-2);
}
.effect span {
  margin-right: 3px;
  color: var(--faint);
}
.permission :deep(.code) {
  max-height: 180px;
  margin: 0;
  background: var(--theme-inset-background, var(--bg-sunken));
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
