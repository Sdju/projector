<script setup lang="ts" generic="T">
import UiMessage from "./UiMessage.vue";
import { shallowRef, watch } from "vue";

/**
 * Runs an async source and renders its result through the default slot. The source is repeated
 * when any key from `watchKeys` changes; a stale response never replaces a newer one.
 */
const props = defineProps<{
  load: () => Promise<T>;
  watchKeys: () => readonly unknown[];
  errorText: string;
  loadingText: string;
}>();
defineSlots<{ default(props: { data: T }): unknown }>();

const data = shallowRef<T>();
const error = shallowRef("");
let request = 0;

async function run() {
  const current = ++request;
  data.value = undefined;
  error.value = "";
  try {
    const next = await props.load();
    if (current === request) data.value = next;
  } catch (err) {
    if (current === request) error.value = err instanceof Error ? err.message : props.errorText;
  }
}

watch(() => props.watchKeys(), run, { immediate: true });
</script>

<template>
  <slot v-if="data !== undefined" :data="data" />
  <UiMessage
    v-else
    size="xs"
    variant="padded"
    :tone="error ? 'danger' : 'muted'"
    :padding="4"
    :role="error ? 'alert' : 'status'"
  >
    {{ error || loadingText }}
  </UiMessage>
</template>
