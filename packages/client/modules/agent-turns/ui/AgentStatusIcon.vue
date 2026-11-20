<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";

/** One status glyph for jobs, tasks and activity: spinner, waiting shield, error, stop or check. */
defineProps<{ status: string; label?: string }>();
</script>

<template>
  <UiSpinner v-if="status === 'running' || status === 'queued'" />
  <ProjectorIcon
    name="shield-question"
    v-else-if="status === 'needs-user' || status === 'waiting'"
    class="waiting-icon"
    aria-hidden="true"
  />
  <ProjectorIcon
    name="circle-alert"
    v-else-if="status === 'error' || status === 'failed'"
    class="error-icon"
    :aria-label="label"
    :aria-hidden="label ? undefined : 'true'"
  />
  <ProjectorIcon
    name="square"
    v-else-if="status === 'stopped' || status === 'canceled'"
    class="faint-icon"
    aria-hidden="true"
  />
  <ProjectorIcon name="check" v-else class="done-icon" aria-hidden="true" />
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
