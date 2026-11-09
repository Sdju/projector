<script setup lang="ts">
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import IconAlert from "~icons/lucide/circle-alert";
import IconCheck from "~icons/lucide/check";
import IconShield from "~icons/lucide/shield-question";
import IconSquare from "~icons/lucide/square";

/** One status glyph for jobs, tasks and activity: spinner, waiting shield, error, stop or check. */
defineProps<{ status: string; label?: string }>();
</script>

<template>
  <UiSpinner v-if="status === 'running' || status === 'queued'" />
  <IconShield
    v-else-if="status === 'needs-user' || status === 'waiting'"
    class="waiting-icon"
    aria-hidden="true"
  />
  <IconAlert
    v-else-if="status === 'error' || status === 'failed'"
    class="error-icon"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
  <IconSquare
    v-else-if="status === 'stopped' || status === 'canceled'"
    class="faint-icon"
    aria-hidden="true"
  />
  <IconCheck v-else class="done-icon" aria-hidden="true" />
</template>

<style scoped>
.waiting-icon {
  color: var(--warn);
}
.error-icon {
  color: var(--err);
}
.done-icon {
  color: var(--run);
}
.faint-icon {
  color: var(--faint);
}
</style>
