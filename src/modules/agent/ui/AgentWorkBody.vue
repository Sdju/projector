<script setup lang="ts">
import AgentActivity from "./AgentActivity.vue";
import AgentThought from "./AgentThought.vue";
import type { AgentWorkItem } from "../lib/work-items.ts";

defineProps<{
  items: AgentWorkItem[];
  /** The last thought of the group is still being written. */
  thinking?: boolean;
  root?: string;
}>();
const emit = defineEmits<{ open: [path: string] }>();
</script>

<template>
  <template v-for="item in items" :key="item.key">
    <AgentThought
      v-if="item.type === 'thought'"
      :text="item.text"
      :streaming="thinking === true && item === items.at(-1)"
    />
    <AgentActivity v-else :tools="item.tools" :root="root" @open="emit('open', $event)" />
  </template>
</template>
