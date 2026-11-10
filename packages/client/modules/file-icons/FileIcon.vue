<script setup lang="ts">
import type { ResolvedFileIcon } from "@projector-ai/core/modules/file-icons/index.ts";
withDefaults(defineProps<{ icon: ResolvedFileIcon; size?: number }>(), { size: 16 });
</script>

<template>
  <span
    class="file-icon"
    aria-hidden="true"
    :data-icon="icon.id"
    :style="{
      '--icon-source': `url('${icon.src}')`,
      '--file-icon-size': `${size}px`,
      color: icon.color,
    }"
  >
    <span class="symbol" />
    <span
      v-if="icon.badge"
      class="badge"
      :data-icon="icon.badge.id"
      :style="{ '--icon-source': `url('${icon.badge.src}')`, color: icon.badge.color }"
      ><span class="badge-symbol"
    /></span>
  </span>
</template>

<style scoped>
.file-icon {
  display: inline-block;
  width: var(--file-icon-size);
  height: var(--file-icon-size);
  flex: 0 0 var(--file-icon-size);
  position: relative;
}
.symbol,
.badge-symbol {
  display: block;
  background: currentColor;
  mask: var(--icon-source) center / contain no-repeat;
  -webkit-mask: var(--icon-source) center / contain no-repeat;
}
.symbol {
  width: var(--file-icon-size);
  height: var(--file-icon-size);
}
.badge {
  position: absolute;
  width: calc(var(--file-icon-size) * 0.75);
  height: calc(var(--file-icon-size) * 0.75);
  right: calc(var(--file-icon-size) * -0.1875);
  bottom: calc(var(--file-icon-size) * -0.125);
  display: grid;
  place-items: center;
  background: var(--bg);
  border-radius: var(--r-sm);
}
.badge-symbol {
  width: calc(var(--file-icon-size) * 0.6875);
  height: calc(var(--file-icon-size) * 0.6875);
}
</style>
