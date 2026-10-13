<script setup lang="ts">
import { computed, provide } from "vue";
import { controlScopeKey } from "../utilities/control-scope.ts";

const props = defineProps<{ density?: "compact" }>();
provide(
  controlScopeKey,
  computed(() =>
    props.density === "compact"
      ? {
          minHeight: "var(--control-h)",
          paddingBlock: "var(--sp-1)",
          fontSize: "var(--ui-control-font-size)",
        }
      : undefined,
  ),
);
</script>

<template>
  <div :class="{ compact: density === 'compact' }"><slot /></div>
</template>

<style scoped>
.compact {
  --ui-control-font-size: var(--fs-sm);
}
@media (max-width: 700px) {
  .compact {
    --ui-control-font-size: var(--fs-input);
  }
}
</style>
