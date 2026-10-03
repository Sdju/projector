<script setup lang="ts">
import type { ResolvedFileIcon } from "../../../core/modules/file-icons/index.ts";
defineProps<{ icon: ResolvedFileIcon }>();
</script>

<template>
  <span
    class="file-icon"
    aria-hidden="true"
    :data-icon="icon.id"
    :style="{ '--icon-source': `url('${icon.src}')`, color: icon.color }"
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
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
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
  width: 16px;
  height: 16px;
}
.badge {
  position: absolute;
  width: 12px;
  height: 12px;
  right: -3px;
  bottom: -2px;
  display: grid;
  place-items: center;
  background: var(--bg);
  border-radius: var(--r-sm);
}
.badge-symbol {
  width: 11px;
  height: 11px;
}
</style>
