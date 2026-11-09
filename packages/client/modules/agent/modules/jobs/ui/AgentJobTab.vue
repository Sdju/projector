<script setup lang="ts">
import { computed, watch } from "vue";
import { useIdeCommands } from "../../../../ide/index.ts";
import { readoutLines, useTabReadout } from "../../../../../common/utilities/tab-readout.ts";
import UiButton from "../../../../../common/ui/UiButton.vue";
import UiDisclosureSummary from "../../../../../common/ui/UiDisclosureSummary.vue";
import UiSpinner from "../../../../../common/ui/UiSpinner.vue";
import { jobFinished } from "../../../../agent-core/index.ts";
import { jobDuration, jobStatusLabel } from "../lib/job-labels.ts";
import { useElapsedClock } from "../../../../agent-core/index.ts";
import { useJobFollow } from "../model/job-follow.ts";
import { useJobTitle } from "../model/job-titles.ts";
import { agentLabel } from "../../../../agent-core/index.ts";
import { provideChatContext } from "../../../../agent-core/index.ts";
import { canContinueInChat, continueJobInChat } from "../model/job-continue.ts";
import { jobTurn } from "../model/job-turn.ts";
import type { AgentPermission, AgentQuestionRequest } from "../../../../agent-core/index.ts";
import { AgentCodeBlock } from "../../../../agent-turns/index.ts";
import { AgentPermissions } from "../../../../agent-turns/index.ts";
import { AgentQuestions } from "../../../../agent-turns/index.ts";
import { AgentTaskFrame } from "../../../../agent-turns/index.ts";
import { AgentTurn } from "../../../../agent-turns/index.ts";
import IconSquare from "~icons/lucide/square";
import IconChat from "~icons/lucide/message-square-share";
import IconChevron from "~icons/lucide/chevron-right";
import IconFile from "~icons/lucide/file-diff";

/** A background job followed in its own tab (read-only): its journal, requests, answer and files. */
const props = defineProps<{ projectId: string; job: string }>();
const emit = defineEmits<{ openFile: [path: string]; title: [title: string] }>();
const { api } = useIdeCommands();
provideChatContext(props.projectId, api);

const { job, journal, error, actionError, missing, stop, decide, answer } = useJobFollow(
  () => props.job,
);
// The agent names its session while it works: the header and tab title follow that name.
const name = useJobTitle(
  () => props.projectId,
  () => job.value,
);
watch(
  name,
  (title) => {
    if (job.value) emit("title", title);
  },
  { immediate: true },
);

const finished = computed(() => !!job.value && jobFinished(job.value.status));
const turn = computed(() =>
  jobTurn(journal.value, `job-${props.job}`, job.value?.startedAt ?? job.value?.createdAt ?? 0),
);
const permissions = computed<AgentPermission[]>(() =>
  (job.value?.pending ?? [])
    .filter((card) => card.kind === "permission")
    .map((card) => ({
      id: card.id,
      tool: card.tool ?? "",
      title: card.title,
      detail: card.detail ?? "",
      persistent: card.persistent === true,
    })),
);
const questions = computed<AgentQuestionRequest[]>(() =>
  (job.value?.pending ?? [])
    .filter((card) => card.kind === "question")
    .map((card) => ({
      id: card.id,
      title: card.title,
      questions: card.questions ?? [],
      custom: card.custom === true,
    })),
);
// The journal holds the streamed answer; the stored result only adds what a long one cut off.
const outcome = computed(() => {
  const result = job.value?.result?.trim() ?? "";
  return finished.value && result && result !== turn.value.text.trim() ? result : "";
});
const now = useElapsedClock();
const meta = computed(() =>
  [
    job.value ? jobStatusLabel[job.value.status] : "",
    job.value ? agentLabel(job.value.backend) : "",
    job.value?.unattended ? "без вопросов" : "",
    job.value?.worktree ? `копия ${job.value.worktree.branch}` : "",
    jobDuration(job.value?.startedAt ?? job.value?.createdAt, job.value?.endedAt, now.value),
  ]
    .filter(Boolean)
    .join(" · "),
);

const proceed = async () => {
  actionError.value = "";
  try {
    if (job.value) await continueJobInChat(api, job.value);
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : "Не удалось открыть чат";
  }
};

useTabReadout(() => ({
  note: "Фоновое задание агента",
  text: job.value
    ? readoutLines(
        `Задание: ${job.value.task}`,
        `Состояние: ${jobStatusLabel[job.value.status]}`,
        `Агент: ${agentLabel(job.value.backend)}`,
        job.value.error ? `Ошибка: ${job.value.error}` : "",
        job.value.pending.length
          ? `Ждёт ответа: ${job.value.pending.map((c) => c.title).join("; ")}`
          : "",
        job.value.files.length ? `Изменено файлов: ${job.value.files.length}` : "",
        job.value.result ? `Итог:\n${job.value.result.slice(0, 2000)}` : "",
      )
    : "Задание загружается",
}));
</script>

<template>
  <section v-if="missing" class="missing" aria-label="Фоновое задание">
    <p class="note" role="status">Задание не найдено: его могли убрать.</p>
  </section>
  <AgentTaskFrame
    v-else
    label="Фоновое задание"
    kind="agent"
    :title="name"
    :hint="job?.task"
    :meta="meta"
    :running="!!job && !finished"
  >
    <template #actions>
      <UiButton
        v-if="job && !finished"
        size="sm"
        title="Остановить задание"
        aria-label="Остановить задание"
        @click="stop"
      >
        <IconSquare aria-hidden="true" /> Остановить
      </UiButton>
      <UiButton
        v-if="job && canContinueInChat(job)"
        size="sm"
        title="Открыть обычный чат агента и продолжить эту сессию"
        aria-label="Продолжить в чате"
        @click="proceed"
      >
        <IconChat aria-hidden="true" /> Продолжить в чате
      </UiButton>
    </template>
    <div class="body" role="log" aria-label="Журнал задания">
      <details v-if="job?.task" class="assignment">
        <UiDisclosureSummary variant="fit" class="assignment-summary">
          <span class="label">Задание</span>
          <IconChevron class="chevron" aria-hidden="true" />
        </UiDisclosureSummary>
        <p class="task-text">{{ job.task }}</p>
      </details>
      <p v-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-if="actionError" class="note error" role="alert">{{ actionError }}</p>
      <p v-if="job?.error" class="note error" role="alert">{{ job.error }}</p>
      <p v-if="job?.worktree && finished" class="note">
        Работа шла в изолированной копии ({{ job.worktree.branch }}): слить её в проект можно
        командой ide.agent.job.merge по просьбе пользователя.
      </p>
      <AgentPermissions :permissions="permissions" @decide="decide" />
      <AgentQuestions :requests="questions" @answer="answer" />
      <AgentTurn
        v-if="journal.length"
        :turn="turn"
        :root="job?.cwd"
        :flags="{ busy: !!job && !finished, last: true, copied: false, readonly: true }"
      />
      <p v-else-if="job && !finished" class="note">
        <UiSpinner /> Агент работает, событий пока нет
      </p>
      <template v-if="outcome">
        <div class="label">Итог</div>
        <AgentCodeBlock :text="outcome" />
      </template>
      <template v-if="job?.files.length">
        <div class="label">
          <IconFile aria-hidden="true" /> Изменённые файлы: {{ job.files.length }}
        </div>
        <ul class="files">
          <li v-for="file in job.files" :key="file">
            <button
              v-if="!job.worktree && !job.worktreeCleared"
              type="button"
              class="file"
              @click="emit('openFile', file)"
            >
              {{ file }}
            </button>
            <span v-else>{{ file }}</span>
          </li>
        </ul>
      </template>
    </div>
  </AgentTaskFrame>
</template>

<style scoped>
svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.missing {
  padding: var(--sp-3);
}
.body {
  display: grid;
  /* A scrollable result block must keep its content height instead of collapsing into a strip. */
  grid-auto-rows: max-content;
  align-content: start;
  gap: var(--sp-2);
  width: min(100%, var(--chat-width, 680px));
  margin: 0 auto;
  padding: var(--sp-3);
  overflow: auto;
  box-sizing: border-box;
  flex: 1;
}
.label {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  margin-top: var(--sp-2);
  color: var(--faint);
}
.assignment {
  display: grid;
  gap: var(--sp-1);
}
.assignment-summary {
  padding: 2px 0;
  color: var(--faint);
}
.assignment-summary .label {
  margin-top: 0;
}
.chevron {
  width: 12px;
  height: 12px;
  transition: transform var(--t-fast);
}
.assignment[open] > .assignment-summary .chevron {
  transform: rotate(90deg);
}
@media (prefers-reduced-motion: reduce) {
  .chevron {
    transition: none;
  }
}
.task-text {
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--bg-3);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.note {
  margin: 0;
  color: var(--faint);
}
.error {
  color: var(--err);
}
.files {
  display: grid;
  gap: 2px;
  margin: 0;
  padding: 0;
  list-style: none;
  font-family: var(--mono);
}
.file {
  padding: 0;
  border: 0;
  background: none;
  color: var(--text);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.file:hover {
  text-decoration: underline;
}
</style>
