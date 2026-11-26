<script setup lang="ts">
import { ref } from "vue";
import UiLoader from "../../../common/ui/UiLoader.vue";

defineProps<{ loading: boolean; empty: boolean; hidden: number; zen: boolean }>();
const emit = defineEmits<{ scroll: []; loadEarlier: [] }>();
const element = ref<HTMLElement>();
defineExpose({ element });
</script>

<template>
  <div class="chat-area" :class="{ zen }">
    <div ref="element" class="chat-log" @scroll.passive="emit('scroll')">
      <div v-if="loading" class="chat-loading">
        <UiLoader label="Загружаю чат…" align="center" />
      </div>
      <slot v-else-if="empty" name="welcome" />
      <div
        v-else
        class="conversation"
        role="log"
        aria-label="Сообщения"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <button v-if="hidden" type="button" class="earlier" @click="emit('loadEarlier')">
          Показать ранние запросы · скрыто {{ hidden }}
        </button>
        <slot />
      </div>
    </div>
    <slot name="timeline" />
  </div>
</template>

<style scoped>
.chat-area {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}
.chat-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
  padding: var(--sp-6) var(--sp-5) var(--sp-4);
}
.chat-loading {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.chat-loading svg {
  width: 16px;
  height: 16px;
}
.earlier {
  display: block;
  margin: 0 auto var(--sp-4);
  padding: var(--sp-1) var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-2xs);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.earlier:hover {
  color: var(--text);
}
.conversation {
  width: 100%;
  max-width: var(--chat-width);
  margin: auto;
}
.chat-area.zen .chat-log {
  padding-bottom: var(--sp-6);
}
@container (max-width: 500px) {
  .chat-log {
    padding: var(--sp-5) var(--sp-4);
  }
}
</style>
