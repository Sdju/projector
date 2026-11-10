<script setup lang="ts">
import { computed } from "vue";
import { answerJob, type AgentJobView } from "../../../../agent-core/index.ts";
import { agentLabel } from "../../../../agent-core/index.ts";
import { AgentPermissions } from "../../../../agent-turns/index.ts";
import { AgentQuestions } from "../../../../agent-turns/index.ts";
import type { AgentPermission, AgentQuestionRequest } from "../../../../agent-core/index.ts";

/** Requests of background jobs shown in the Projector chat: the user answers them, not the model. */
const props = defineProps<{
  jobs: AgentJobView[];
  /** API prefix when the job belongs to another device of the Hub. */
  base?: string;
}>();
const emit = defineEmits<{ answered: [] }>();

const jobsOf = computed(
  () => new Map(props.jobs.flatMap((job) => job.pending.map((card) => [card.id, job.id] as const))),
);

const permissions = computed<(AgentPermission & { job: string })[]>(() =>
  props.jobs.flatMap((job) =>
    job.pending
      .filter((card) => card.kind === "permission")
      .map((card) => ({
        id: card.id,
        job: job.id,
        tool: card.tool ?? "",
        title: `${agentLabel(job.backend)} · ${card.title}`,
        detail: card.detail ?? "",
        persistent: card.persistent === true,
      })),
  ),
);

const questions = computed<(AgentQuestionRequest & { job: string })[]>(() =>
  props.jobs.flatMap((job) =>
    job.pending
      .filter((card) => card.kind === "question" && card.questions?.length)
      .map((card) => ({
        id: card.id,
        job: job.id,
        title: `${agentLabel(job.backend)} · ${card.title || "Вопрос"}`,
        questions: card.questions!,
        custom: card.custom === true,
      })),
  ),
);

async function decide(id: string, allow: boolean, always?: boolean): Promise<void> {
  const job = jobsOf.value.get(id);
  if (!job) return;
  try {
    await answerJob(job, { request: id, allow, always }, props.base);
  } catch {
    // The request was answered in another tab or timed out: the next poll removes the card.
  }
  emit("answered");
}

async function answer(id: string, answers: Record<string, string[]> | null): Promise<void> {
  const job = jobsOf.value.get(id);
  if (!job) return;
  try {
    await answerJob(job, { request: id, answers }, props.base);
  } catch {
    // Same as a permission: a stale card disappears after the refresh.
  }
  emit("answered");
}
</script>

<template>
  <AgentPermissions :permissions="permissions" @decide="decide" />
  <AgentQuestions :requests="questions" @answer="answer" />
</template>
