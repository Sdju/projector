<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

/** Текст, усечённый по центру: начало и конец сохраняются, середина заменяется на «…». */
const props = defineProps<{ text: string }>();
const host = ref<HTMLElement>();
const display = ref(props.text);
let observer: ResizeObserver | undefined;
let frame = 0;
let measurer: HTMLSpanElement | undefined;

function measuringSpan() {
  if (measurer) return measurer;
  measurer = document.createElement("span");
  measurer.setAttribute("aria-hidden", "true");
  measurer.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;white-space:pre;width:max-content;max-width:none;";
  document.body.appendChild(measurer);
  return measurer;
}

function measure(value: string) {
  const element = host.value;
  if (!element) return 0;
  const span = measuringSpan();
  const style = getComputedStyle(element);
  span.style.font = style.font || `${style.fontSize} ${style.fontFamily}`;
  span.style.fontWeight = style.fontWeight;
  span.style.fontStyle = style.fontStyle;
  span.style.letterSpacing = style.letterSpacing;
  span.textContent = value;
  return span.getBoundingClientRect().width;
}

function cut(keep: number) {
  const length = props.text.length;
  if (keep >= length) return props.text;
  if (keep <= 1) return "…";
  const start = Math.ceil(keep / 2);
  const end = keep - start;
  return `${props.text.slice(0, start)}…${props.text.slice(length - end)}`;
}

function fit() {
  const element = host.value;
  if (!element) return;
  const width = element.clientWidth;
  if (!width) return;
  if (measure(props.text) <= width) {
    display.value = props.text;
    return;
  }
  let low = 1;
  let high = props.text.length;
  let best = "…";
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = cut(middle);
    if (measure(candidate) <= width) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  display.value = best;
}

function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(fit);
}

onMounted(() => {
  const element = host.value;
  if (!element) return;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(schedule);
    observer.observe(element);
  }
  void document.fonts?.ready.then(schedule);
  schedule();
});

watch(() => props.text, schedule);
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  observer?.disconnect();
});
</script>

<template>
  <span ref="host" class="middle-truncate" :title="text">{{ display }}</span>
</template>

<style scoped>
.middle-truncate {
  display: block;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
</style>
