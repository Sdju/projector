<script setup lang="ts">
import { computed, ref } from "vue";
import type { AgentTurn } from "../../agent-core/index.ts";
const props = defineProps<{ turns: AgentTurn[] }>();
const emit = defineEmits<{ select: [id: string] }>();
const requests = computed(() => props.turns.filter((turn) => turn.role === "user"));
const timelinePreview = ref<{ index: number; text: string; top: number }>();
function previewRequest(event: Event, index: number, text: string) {
  const button = event.currentTarget as HTMLElement;
  const area = button.closest(".chat-area");
  if (!area) return;
  const bounds = button.getBoundingClientRect();
  timelinePreview.value = {
    index,
    text: text
      .replace(/<[^>]*>/g, " ")
      .replace(/[`*_#]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220),
    top: bounds.top + bounds.height / 2 - area.getBoundingClientRect().top,
  };
}
</script>
<template>
  <div class="timeline-edge">
    <nav class="timeline" aria-label="Переход к запросам" @scroll="timelinePreview = undefined">
      <button
        v-for="(request, index) in requests"
        :key="request.id"
        type="button"
        class="timeline-point"
        :aria-label="`Запрос ${index + 1}: ${request.text || 'Без текста'}`"
        @mouseenter="previewRequest($event, index, request.text)"
        @mouseleave="timelinePreview = undefined"
        @focus="previewRequest($event, index, request.text)"
        @blur="timelinePreview = undefined"
        @click="emit('select', request.id)"
      >
        <span class="timeline-dot" />
      </button>
    </nav>
  </div>
  <div
    v-if="timelinePreview"
    class="timeline-preview"
    :style="{ top: `${timelinePreview.top}px` }"
    role="tooltip"
  >
    <span>Запрос {{ timelinePreview.index + 1 }}</span>
    <p>{{ timelinePreview.text || "Без текста" }}</p>
  </div>
</template>
<style scoped>
.timeline-edge {
  position: absolute;
  z-index: 2;
  right: 0;
  top: 0;
  bottom: 0;
  width: 28px;
}
.timeline {
  position: absolute;
  right: 2px;
  top: 50%;
  transform: translateY(-50%);
  max-height: 75%;
  overflow-y: auto;
  overflow-x: visible;
  display: flex;
  flex-direction: column;
  scrollbar-width: none;
}
.timeline-point {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  min-height: 18px;
  padding: 0;
}
.timeline-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--muted);
  opacity: 0;
  transition: opacity 120ms ease;
}
.timeline-edge:hover .timeline-dot,
.timeline:focus-within .timeline-dot {
  opacity: 0.65;
}
.timeline-preview {
  position: absolute;
  z-index: 3;
  right: 34px;
  transform: translateY(-50%);
  width: max-content;
  max-width: min(280px, 70%);
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text);
  font-size: var(--fs-2xs);
  pointer-events: none;
}
.timeline-preview span {
  color: var(--muted);
}
.timeline-preview p {
  margin: 3px 0 0;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.timeline-point:hover .timeline-dot,
.timeline-point:focus-visible .timeline-dot {
  opacity: 1;
  transform: scale(1.5);
}
</style>
