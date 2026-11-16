<script setup lang="ts">
import { computed } from "vue";
import {
  answerPermission,
  answerQuestion,
  answerSecret,
  type AgentPermission,
  type AgentQuestionRequest,
  type AgentRunPending,
  type AgentSecretRequest,
} from "../../../../agent-core/index.ts";
import { AgentPermissions, AgentQuestions, AgentSecrets } from "../../../../agent-turns/index.ts";

/** User-facing requests of a live chat run shown in the notification center. */
const props = defineProps<{
  pending: AgentRunPending[];
  agent: string;
  base?: string;
}>();
const emit = defineEmits<{ answered: [] }>();

const permissions = computed<AgentPermission[]>(() =>
  props.pending
    .filter((card) => card.kind === "permission")
    .map((card) => ({
      id: card.id,
      tool: card.tool ?? "",
      title: `${props.agent} · ${card.title}`,
      detail: card.detail ?? "",
      persistent: card.persistent === true,
      ...(card.judge ? { judge: card.judge } : {}),
    })),
);

const questions = computed<AgentQuestionRequest[]>(() =>
  props.pending
    .filter((card) => card.kind === "question" && card.questions?.length)
    .map((card) => ({
      id: card.id,
      title: `${props.agent} · ${card.title || "Вопрос"}`,
      questions: card.questions!,
      custom: card.custom === true,
    })),
);

const secrets = computed<AgentSecretRequest[]>(() =>
  props.pending
    .filter((card) => card.kind === "secret" && card.destination)
    .map((card) => ({
      id: card.id,
      label: `${props.agent} · ${card.title}`,
      reason: card.reason,
      destination: card.destination!,
    })),
);

async function decide(id: string, allow: boolean, always = false): Promise<void> {
  try {
    await answerPermission(id, allow, always, props.base);
  } catch {
    // Answered in the chat tab or timed out: the refresh clears it.
  }
  emit("answered");
}

async function answer(id: string, answers: Record<string, string[]> | null): Promise<void> {
  try {
    await answerQuestion(id, answers, props.base);
  } catch {
    // Answered in the chat tab or timed out: the refresh clears it.
  }
  emit("answered");
}

async function answerSecretRequest(id: string, value: string | null): Promise<void> {
  try {
    await answerSecret(id, value, props.base);
  } catch {
    // Answered in the chat tab or timed out: the refresh clears it.
  }
  emit("answered");
}
</script>

<template>
  <AgentPermissions :permissions="permissions" @decide="decide" />
  <AgentQuestions :requests="questions" @answer="answer" />
  <AgentSecrets :requests="secrets" @answer="answerSecretRequest" />
</template>
