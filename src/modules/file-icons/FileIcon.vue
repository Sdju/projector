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
  />
</template>

<style scoped>
.file-icon {
  display: inline-block;
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  background: currentColor;
  mask: var(--icon-source) center / contain no-repeat;
  -webkit-mask: var(--icon-source) center / contain no-repeat;
}
</style>
