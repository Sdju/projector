<script setup lang="ts">
import { reactive } from "vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentQuestionRequest } from "../model/types.ts";
import IconHelp from "~icons/lucide/message-circle-question";

defineProps<{ requests: AgentQuestionRequest[] }>();
const emit = defineEmits<{ answer: [id: string, answers: Record<string, string[]> | null] }>();

/** Chosen option IDs and the user's own text, by request and question. */
const chosen = reactive<Record<string, string[]>>({});
const written = reactive<Record<string, string>>({});
const key = (request: string, question: string) => `${request}\n${question}`;

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

const complete = (request: AgentQuestionRequest) => {
  const answers = answersOf(request);
  return request.questions.every((item) => item.optional || answers[item.id]!.length > 0);
};

function submit(request: AgentQuestionRequest) {
  if (complete(request)) emit("answer", request.id, answersOf(request));
}
</script>

<template>
  <div v-if="requests.length" class="questions" role="dialog" aria-label="Вопрос агента">
    <section v-for="request in requests" :key="request.id" class="question">
      <UiInline as="header" align="center" justify="normal">
        <IconHelp aria-hidden="true" />
        <span class="title">{{ request.title || "Агент спрашивает" }}</span>
      </UiInline>
      <fieldset v-for="question in request.questions" :key="question.id">
        <legend>
          <span v-if="question.header" class="header">{{ question.header }}</span>
          {{ question.question }}
        </legend>
        <label v-for="option in question.options" :key="option.id" class="option">
          <input
            :type="question.multiple ? 'checkbox' : 'radio'"
            :name="`${request.id}-${question.id}`"
            :checked="(chosen[key(request.id, question.id)] ?? []).includes(option.id)"
            @click="toggle(request.id, question, option.id)"
          />
          <span class="label">
            {{ option.label }}
            <small v-if="option.description">{{ option.description }}</small>
          </span>
        </label>
        <input
          v-if="request.custom || question.custom"
          v-model="written[key(request.id, question.id)]"
          class="own"
          type="text"
          placeholder="Свой вариант"
          aria-label="Свой вариант ответа"
          @keydown.enter.prevent="submit(request)"
        />
      </fieldset>
      <UiInline align="stretch">
        <UiButton appearance="solid" :disabled="!complete(request)" @click="submit(request)">
          Ответить
        </UiButton>
        <UiButton @click="emit('answer', request.id, null)"> Пропустить </UiButton>
      </UiInline>
    </section>
  </div>
</template>

<style scoped>
/* Над полем ввода поверх переписки: появление вопроса не сдвигает сообщения. */
.questions {
  position: absolute;
  inset-inline: var(--sp-5);
  bottom: calc(100% + var(--sp-2));
  z-index: var(--z-expanded);
  display: grid;
  gap: var(--sp-2);
  max-height: min(70vh, 560px);
  overflow: auto;
  scrollbar-width: thin;
}
.question {
  display: grid;
  gap: var(--sp-3);
  padding: var(--sp-4);
  border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--line-strong));
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--warn) 6%, var(--bg-2));
  box-shadow: var(--shadow-popover);
  color: var(--text);
  font-size: var(--fs-md);
  line-height: 1.5;
}
header {
  min-width: 0;
}
header svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  font-weight: 600;
}
fieldset {
  display: grid;
  gap: var(--sp-1);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
legend {
  padding: 0;
  margin-bottom: var(--sp-2);
  overflow-wrap: anywhere;
}
.header {
  margin-right: var(--sp-2);
  padding: 1px var(--sp-2);
  border-radius: var(--r-sm);
  background: var(--bg-4);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.option {
  display: flex;
  gap: var(--sp-3);
  align-items: flex-start;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-md);
  cursor: pointer;
  transition: background var(--t-fast);
}
.option:hover {
  background: var(--hover);
}
.option input {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin: 3px 0 0;
  accent-color: var(--accent);
}
.label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.option small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: var(--fs-sm);
  line-height: 1.5;
}
.own {
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--bg-sunken);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-sm);
}
.own:focus {
  border-color: var(--accent);
  outline: none;
}
</style>
