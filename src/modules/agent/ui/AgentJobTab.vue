<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useIdeCommands } from "../../ide/index.ts";
import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import UiButton from "../../../common/ui/UiButton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";
import {
  answerJob,
  fetchJob,
  jobFinished,
  stopJob,
  type AgentJobEntry,
  type AgentJobView,
} from "../api/jobs.ts";
import { jobDuration, jobStatusLabel } from "../lib/job-labels.ts";
import { useElapsedClock } from "../lib/elapsed.ts";
import { agentLabel } from "../model/modes.ts";
import { canContinueInChat, continueJobInChat } from "../model/job-continue.ts";
import { jobTurn } from "../model/job-turn.ts";
import type { AgentPermission, AgentQuestionRequest } from "../model/types.ts";
import AgentCodeBlock from "./AgentCodeBlock.vue";
import AgentPermissions from "./AgentPermissions.vue";
import AgentQuestions from "./AgentQuestions.vue";
import AgentTurn from "./AgentTurn.vue";
import IconBot from "~icons/lucide/bot";
import IconSquare from "~icons/lucide/square";
import IconChat from "~icons/lucide/message-square-share";
import IconFile from "~icons/lucide/file-diff";

/** A background job followed in its own tab (read-only): its journal, requests, answer and files. */
const props = defineProps<{ projectId: string; job: string }>();
const emit = defineEmits<{ openFile: [path: string]; title: [title: string] }>();
const { api } = useIdeCommands();

const job = ref<AgentJobView>();
const journal = ref<AgentJobEntry[]>([]);
const error = ref("");
const actionError = ref("");
const missing = ref(false);

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

let alive = true;
let controller: AbortController | undefined;
let generation = 0;
const POLL_GAP_MS = 100;

function apply(data: { job: AgentJobView; journal: AgentJobEntry[] }): void {
  job.value = data.job;
  journal.value = data.journal;
  error.value = "";
  emit("title", `${agentLabel(data.job.backend)}: ${data.job.task.trim().slice(0, 40)}`);
}

async function follow(): Promise<void> {
  const mine = ++generation;
  let rev = 0;
  while (alive && mine === generation) {
    controller = new AbortController();
    try {
      // The first read is at once, later ones wait for the server to report a change.
      const data = await fetchJob(props.job, rev ? 25 : 0, rev, controller.signal);
      if (!alive || mine !== generation) return;
      apply(data);
      rev = data.job.rev;
      if (jobFinished(data.job.status)) return;
      await new Promise((resolve) => setTimeout(resolve, POLL_GAP_MS));
    } catch (cause) {
      if (!alive || mine !== generation) return;
      const message = cause instanceof Error ? cause.message : "Не удалось прочитать задание";
      if (/не найдено/.test(message)) {
        missing.value = true;
        return;
      }
      error.value = message;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
watch(
  () => props.job,
  () => {
    generation++;
    controller?.abort();
    void follow();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  alive = false;
  controller?.abort();
});

async function act(run: () => Promise<unknown>): Promise<void> {
  actionError.value = "";
  try {
    await run();
    // The long poll brings the change; read once more now so the card goes at once.
    apply(await fetchJob(props.job));
  } catch (cause) {
    actionError.value = cause instanceof Error ? cause.message : "Не удалось выполнить действие";
  }
}
const stop = () => act(() => stopJob(props.job));
const decide = (id: string, allow: boolean, always = false) =>
  act(() => answerJob(props.job, { request: id, allow, always }));
const answer = (id: string, answers: Record<string, string[]> | null) =>
  act(() => answerJob(props.job, { request: id, answers }));
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
  <section v-if="missing" class="job" aria-label="Фоновое задание">
    <p class="note" role="status">Задание не найдено: его могли убрать.</p>
  </section>
  <section v-else class="job" aria-label="Фоновое задание">
    <header class="head">
      <IconBot class="kind" aria-hidden="true" />
      <div class="titles">
        <div class="title u-truncate" :title="job?.task">{{ job?.task || "Задание" }}</div>
        <div class="meta">
          <UiSpinner v-if="job && !finished" />
          {{ meta }}
        </div>
      </div>
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
    </header>
    <div class="body" role="log" aria-label="Журнал задания">
      <p v-if="error" class="note error" role="alert">{{ error }}</p>
      <p v-if="actionError" class="note error" role="alert">{{ actionError }}</p>
      <p v-if="job?.error" class="note error" role="alert">{{ job.error }}</p>
      <p v-if="job?.worktree && finished" class="note">
        Работа шла в изолированной копии ({{ job.worktree.branch }}): слить её в проект можно в чате
        по просьбе, командой ide.agent.worktree.merge.
      </p>
      <AgentPermissions :permissions="permissions" @decide="decide" />
      <AgentQuestions :requests="questions" @answer="answer" />
      <AgentTurn
        v-if="journal.length"
        :turn="turn"
        :busy="!!job && !finished"
        last
        :copied="false"
        :root="job?.cwd"
        readonly
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
            <button v-if="!job.worktree" type="button" class="file" @click="emit('openFile', file)">
              {{ file }}
            </button>
            <span v-else>{{ file }}</span>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
.job {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  color: var(--muted);
  font-size: var(--fs-2xs);
}
svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.head {
  display: flex;
  gap: var(--sp-2);
  align-items: center;
  padding: var(--sp-2) var(--sp-3);
  border-bottom: 1px solid var(--line);
}
.kind {
  color: var(--faint);
}
.titles {
  display: grid;
  min-width: 0;
  flex: 1;
}
.title {
  color: var(--text);
  font-size: var(--fs-sm);
}
.meta {
  display: flex;
  gap: var(--sp-1);
  align-items: center;
  color: var(--faint);
}
.body {
  display: grid;
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
