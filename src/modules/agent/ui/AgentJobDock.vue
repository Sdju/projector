<script setup lang="ts">
import { useJobChat } from "../model/job-chat.ts";
import AgentJobBar from "./AgentJobBar.vue";
import AgentJobRequests from "./AgentJobRequests.vue";

/** Jobs of the project in the Projector chat: their strip and the requests waiting for the user. */
const props = defineProps<{
  projectId: string;
  chat: string;
  enabled: boolean;
  send: (text: string, options?: { auto?: string }) => Promise<void>;
}>();

const { jobs, refresh, open } = useJobChat(props.projectId, {
  enabled: () => props.enabled,
  chat: props.chat,
  send: props.send,
});
</script>

<template>
  <AgentJobBar v-if="enabled" :jobs="jobs" @open="open" />
  <AgentJobRequests v-if="enabled" :jobs="jobs" @answered="refresh" />
</template>
