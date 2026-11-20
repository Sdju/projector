<script setup lang="ts">
import ProjectorIcon from "../../../../../common/icons/ProjectorIcon.vue";
import { computed } from "vue";
import type { TrustNotice } from "@ai-projector/core/modules/trust-notices/index.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiStatusDot from "../../../../../common/ui/UiStatusDot.vue";

const props = defineProps<{
  notice: TrustNotice;
  href: string;
  unread?: boolean;
  busy?: boolean;
}>();
const emit = defineEmits<{ open: [MouseEvent]; read: []; trust: [] }>();

const KIND_LABELS: Record<TrustNotice["kind"], string> = {
  plugin: "плагин",
  appearance: "оформление",
  roles: "роли",
  widgets: "виджеты",
  presets: "пресеты",
  devcontainer: "dev container",
};

const kind = computed(() => KIND_LABELS[props.notice.kind]);
const action = computed(() =>
  props.notice.scope === "plugin" ? "Открыть плагины" : "Открыть проект",
);
const when = computed(() =>
  new Date(props.notice.createdAt).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }),
);
</script>

<template>
  <article class="item" :class="{ read: !unread }">
    <a
      :href="href"
      class="main"
      :title="action"
      data-command="ide.inbox.notice.open"
      @click="emit('open', $event)"
    >
      <span class="head">
        <UiStatusDot tone="warning" />
        <span class="topic">{{ notice.title }}</span>
      </span>
      <span class="meta">{{ notice.name }} · {{ kind }} · {{ when }}</span>
      <span class="preview">{{ notice.body }}</span>
    </a>
    <div class="actions">
      <UiButton
        shape="icon"
        size="sm"
        title="Вернуть доверие"
        aria-label="Вернуть доверие"
        :busy="busy"
        :disabled="busy"
        @click="emit('trust')"
      >
        <ProjectorIcon name="shield-check" aria-hidden="true" />
      </UiButton>
      <UiButton
        v-if="unread"
        shape="icon"
        size="sm"
        title="Отметить прочитанным"
        aria-label="Отметить прочитанным"
        @click="emit('read')"
      >
        <ProjectorIcon name="check" aria-hidden="true" />
      </UiButton>
    </div>
  </article>
</template>

<style scoped>
.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  min-width: 0;
  border-top: 1px solid var(--line);
}
.item:hover {
  background: var(--hover);
}
.main {
  --indent: calc(7px + var(--sp-2));
  display: flex;
  flex-direction: column;
  gap: var(--sp-1);
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  color: var(--text-2);
  text-align: left;
  text-decoration: none;
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--sp-2);
  min-width: 0;
}
.head :deep(.ui-status-dot) {
  align-self: center;
}
.topic {
  min-width: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 500;
  line-height: 1.35;
}
.item.read .topic {
  color: var(--text-2);
  font-weight: 400;
}
.meta {
  padding-left: var(--indent);
  overflow: hidden;
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.preview {
  padding-left: var(--indent);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.actions {
  display: flex;
  gap: 2px;
  padding: var(--sp-1) var(--sp-2) 0 0;
}
</style>
