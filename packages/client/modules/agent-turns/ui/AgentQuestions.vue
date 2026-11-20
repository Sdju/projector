<script setup lang="ts">
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import { reactive } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentQuestionRequest } from "../../agent-core/index.ts";

const props = withDefaults(
  defineProps<{
    requests: AgentQuestionRequest[];
    /** A narrow surface such as the works panel: no descriptions, tighter rhythm. */
    compact?: boolean;
  }>(),
  { compact: false },
);
const emit = defineEmits<{ answer: [id: string, answers: Record<string, string[]> | null] }>();

/** Chosen option IDs and the user's own text, by request and question. */
const chosen = reactive<Record<string, string[]>>({});
const written = reactive<Record<string, string>>({});
const collapsed = reactive<Record<string, boolean>>({});
const key = (request: string, question: string) => `${request}\n${question}`;

const isCollapsed = (request: string) => collapsed[request] ?? props.compact;
function toggleCollapsed(request: string) {
  collapsed[request] = !isCollapsed(request);
}

function toggle(request: string, question: AgentQuestionRequest["questions"][number], id: string) {
  const at = key(request, question.id);
  const current = chosen[at] ?? [];
  if (question.multiple)
    chosen[at] = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  else chosen[at] = current[0] === id ? [] : [id];
}

function answersOf(request: AgentQuestionRequest): Record<string, string[]> {
  const answers: Record<string, string[]> = {};
  for (const question of request.questions) {
    const at = key(request.id, question.id);
    const own = (written[at] ?? "").trim();
    const list = [...(chosen[at] ?? []), ...(own ? [own] : [])];
    // A single-choice question takes the user's own words instead of the option.
    answers[question.id] = !question.multiple && own ? [own] : list;
  }
  return answers;
}

const ownQuestion = (request: AgentQuestionRequest) =>
  request.questions.length === 1 && (request.custom || request.questions[0]!.custom)
    ? request.questions[0]
    : undefined;

/** The custom answer is part of the action row when the request has only one question. */
const ownKey = (request: AgentQuestionRequest) => {
  const question = ownQuestion(request);
  return question ? key(request.id, question.id) : "";
};

const complete = (request: AgentQuestionRequest) => {
  const answers = answersOf(request);
  return request.questions.every((item) => item.optional || answers[item.id]!.length > 0);
};

function submit(request: AgentQuestionRequest) {
  if (complete(request)) emit("answer", request.id, answersOf(request));
}
</script>

<template>
  <div v-if="requests.length" class="questions" role="group" aria-label="Вопрос агента">
    <section
      v-for="request in requests"
      :key="request.id"
      class="question"
      :class="{ compact, collapsed: isCollapsed(request.id) }"
    >
      <UiButton
        class="fold"
        shape="icon"
        size="sm"
        appearance="quiet"
        :title="isCollapsed(request.id) ? 'Развернуть вопрос' : 'Свернуть вопрос'"
        :aria-label="isCollapsed(request.id) ? 'Развернуть вопрос' : 'Свернуть вопрос'"
        :aria-expanded="!isCollapsed(request.id)"
        @click="toggleCollapsed(request.id)"
      >
        <span class="fold-icon"><ProjectorIcon name="chevron-down" aria-hidden="true" /></span>
      </UiButton>
      <fieldset v-for="question in request.questions" :key="question.id" class="ask">
        <legend class="legend">
          <span v-if="question.header" class="header">{{ question.header }}</span>
          <span class="prompt">{{ question.question }}</span>
        </legend>
        <template v-if="!isCollapsed(request.id)">
          <div v-if="question.options.length" class="options">
            <label
              v-for="option in question.options"
              :key="option.id"
              class="option"
              :class="{ picked: (chosen[key(request.id, question.id)] ?? []).includes(option.id) }"
              :title="option.description"
            >
              <input
                :type="question.multiple ? 'checkbox' : 'radio'"
                :name="`${request.id}-${question.id}`"
                :checked="(chosen[key(request.id, question.id)] ?? []).includes(option.id)"
                @click="toggle(request.id, question, option.id)"
              />
              <span class="text">
                <span class="label">{{ option.label }}</span>
                <small v-if="option.description && !compact" class="description"
                  >— {{ option.description }}</small
                >
              </span>
            </label>
          </div>
          <label
            v-if="(request.custom || question.custom) && ownQuestion(request) !== question"
            class="own"
          >
            <ProjectorIcon name="pencil-line" aria-hidden="true" />
            <input
              v-model="written[key(request.id, question.id)]"
              type="text"
              placeholder="Свой вариант"
              aria-label="Свой вариант ответа"
              @keydown.enter.prevent="submit(request)"
            />
          </label>
        </template>
      </fieldset>
      <div v-if="!isCollapsed(request.id)" class="footer">
        <label v-if="ownQuestion(request)" class="own">
          <ProjectorIcon name="pencil-line" aria-hidden="true" />
          <input
            v-model="written[ownKey(request)]"
            type="text"
            placeholder="Свой вариант"
            aria-label="Свой вариант ответа"
            @keydown.enter.prevent="submit(request)"
          />
        </label>
        <div class="actions">
          <UiButton
            appearance="quiet"
            size="sm"
            shape="icon"
            title="Пропустить"
            aria-label="Пропустить вопрос"
            @click="emit('answer', request.id, null)"
          >
            <ProjectorIcon name="skip-forward" aria-hidden="true" />
          </UiButton>
          <UiButton
            appearance="solid"
            size="sm"
            shape="icon"
            title="Ответить"
            aria-label="Ответить"
            :disabled="!complete(request)"
            @click="submit(request)"
          >
            <ProjectorIcon name="check" aria-hidden="true" />
          </UiButton>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.questions {
  display: grid;
  gap: var(--sp-2);
}
.question {
  position: relative;
  display: grid;
  gap: 8px;
  padding: 10px 12px 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--theme-inset-background, var(--bg-2));
  color: var(--text-2);
  font-size: var(--fs-xs);
  line-height: 1.5;
}
.fold {
  position: absolute;
  top: 6px;
  right: 6px;
}
.question.compact .fold {
  top: 0;
  right: 0;
}
.fold-icon {
  display: flex;
  transition: transform var(--t-fast);
}
.question.collapsed .fold-icon {
  transform: rotate(-90deg);
}
.question.compact {
  gap: 6px;
  /* Align with the row's text column: row padding + status dot and its gap. */
  padding: 4px 0 0 calc(7px + var(--sp-2));
  border: 0;
  background: transparent;
}
.ask {
  display: grid;
  gap: 4px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.legend {
  display: grid;
  gap: 2px;
  min-width: 0;
  padding: 0 32px 0 0;
  overflow-wrap: anywhere;
}
.header {
  color: var(--faint);
  font-size: var(--fs-2xs);
  font-weight: 500;
  letter-spacing: 0.02em;
}
.prompt {
  color: var(--text);
}
.options {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.option {
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin: 0 -6px;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  color: var(--text-2);
  cursor: pointer;
  transition:
    background var(--t-fast),
    color var(--t-fast);
}
.option:hover {
  background: var(--hover);
  color: var(--text);
}
.option.picked {
  background: var(--theme-raised-background, var(--bg-3));
  color: var(--text);
}
.question.compact .option {
  padding: 3px 6px;
}
.question.compact .option.picked {
  background: var(--bg-4);
}
.option input {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  margin: 1.5px 0 0;
  accent-color: var(--accent);
}
.text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.description {
  margin-left: 3px;
  color: var(--muted);
  font-size: var(--fs-2xs);
  line-height: 1.45;
}
.question.compact .description {
  display: none;
}
.question.compact.collapsed .header {
  display: none;
}
.question.compact.collapsed .prompt {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.own {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 -6px;
  padding: 4px 6px;
  border-radius: var(--r-sm);
  color: var(--faint);
  cursor: text;
}
.question.compact .own {
  padding: 3px 6px;
}
.own:focus-within {
  background: var(--theme-raised-background, var(--bg-3));
}
.question.compact .own:focus-within {
  background: var(--bg-4);
}
.own svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.own input {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: var(--fs-xs);
}
.own input::placeholder {
  color: var(--faint);
}
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.footer .own {
  flex: 1;
  margin: 0;
  padding-inline: 0;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
</style>
