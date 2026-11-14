<script setup lang="ts">
import { computed } from "vue";
import type { TrustNotice } from "@ai-projector/core/modules/trust-notices/index.ts";
import UiBadge from "../../../../../common/ui/UiBadge.vue";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiInline from "../../../../../common/ui/UiInline.vue";

const props = defineProps<{ notice: TrustNotice; unread?: boolean; busy?: boolean }>();
const emit = defineEmits<{ open: []; read: []; trust: [] }>();

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
  <article class="item" :class="{ unread }">
    <UiInline class="meta" :gap="1.5" wrap>
      <UiBadge tone="warning">{{ kind }}</UiBadge>
      <span class="agent">{{ notice.name }}</span>
      <span class="when">{{ when }}</span>
    </UiInline>
    <p class="topic">{{ notice.title }}</p>
    <p class="preview">{{ notice.body }}</p>
    <UiInline class="actions" :gap="1.5" wrap>
      <UiButton size="sm" @click="emit('open')">{{ action }}</UiButton>
      <UiButton size="sm" :busy="busy" :disabled="busy" @click="emit('trust')">
        Вернуть доверие
      </UiButton>
      <UiButton
        v-if="unread"
        size="sm"
        title="Отметить уведомление прочитанным"
        @click="emit('read')"
      >
        Прочитано
      </UiButton>
    </UiInline>
  </article>
</template>

<style scoped>
.item {
  display: grid;
  gap: var(--sp-2);
  min-width: 0;
  padding: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
}
.item.unread {
  border-color: color-mix(in srgb, var(--warn) 45%, var(--line));
}
.meta {
  min-width: 0;
}
.agent {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--muted);
}
.when {
  margin-left: auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.topic {
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  font-size: var(--fs-xs);
  line-height: 1.4;
}
.preview {
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.4;
}
.actions {
  min-width: 0;
}
</style>
