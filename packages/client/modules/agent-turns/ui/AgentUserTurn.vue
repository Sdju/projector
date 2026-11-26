<script setup lang="ts">
import { computed, ref } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { zenMode } from "../../../common/utilities/zen-mode.ts";
import {
  chipIcon,
  chipLabel,
  chipTitle,
  versionsOf,
  type AgentTurn,
  type MessageChip,
  type MessagePart,
} from "../../agent-core/index.ts";
import AgentFormAnswer from "./AgentFormAnswer.vue";
import { useTurnStamp } from "../model/turn-stamp.ts";

const props = defineProps<{
  turn: AgentTurn;
  busy: boolean;
  readonly: boolean;
  projectId: string;
}>();
const emit = defineEmits<{
  open: [chip: MessageChip];
  edit: [id: string];
  formSubmit: [id: string, text: string, data: unknown, summary?: string];
  rewind: [id: string];
  fork: [id: string, mode: "before"];
  version: [id: string, target: number];
}>();
/** A message part that is plain text: the template asks this, so the renderer narrows the union once. */
function isTextPart(part: MessagePart): part is Extract<MessagePart, { type: "text" }> {
  return part.type === "text";
}

const versions = computed(() => versionsOf(props.turn));
const formAnswer = ref<InstanceType<typeof AgentFormAnswer>>();
const editTitle = computed(() =>
  props.turn.form ? "Изменить ответ в форме" : "Править и отправить заново",
);
function editMessage() {
  if (props.turn.form) formAnswer.value?.start();
  else emit("edit", props.turn.id);
}
function submitForm(text: string, data: unknown, summary?: string) {
  emit("formSubmit", props.turn.id, text, data, summary);
}

const { written, stamp, stampFull } = useTurnStamp(() => props.turn.at);
</script>

<template>
  <div class="user-row">
    <UiInline
      v-if="!readonly && !zenMode"
      :gap="0.5"
      justify="normal"
      class="turn-actions"
      :class="{ pinned: versions.count > 1 }"
    >
      <time v-if="stamp" class="turn-time" :title="stampFull" :datetime="written?.toISOString()">{{
        stamp
      }}</time>
      <UiInline
        as="span"
        gap="none"
        justify="normal"
        v-if="versions.count > 1"
        class="versions"
        role="group"
        aria-label="Версии"
      >
        <UiButton
          shape="icon"
          size="sm"
          title="Предыдущая версия"
          aria-label="Предыдущая версия"
          :disabled="busy || versions.position === 0"
          @click="emit('version', turn.id, versions.position - 1)"
        >
          <ProjectorIcon name="chevron-left" aria-hidden="true" />
        </UiButton>
        <span class="version-count">{{ versions.position + 1 }} / {{ versions.count }}</span>
        <UiButton
          shape="icon"
          size="sm"
          title="Следующая версия"
          aria-label="Следующая версия"
          :disabled="busy || versions.position === versions.count - 1"
          @click="emit('version', turn.id, versions.position + 1)"
        >
          <ProjectorIcon name="chevron-right" aria-hidden="true" />
        </UiButton>
      </UiInline>
      <UiButton
        shape="icon"
        size="sm"
        class="turn-action"
        :title="editTitle"
        aria-label="Править сообщение"
        :disabled="busy"
        @click="editMessage"
      >
        <ProjectorIcon name="pencil" aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        class="turn-action"
        title="Откатить к этому сообщению"
        aria-label="Откатить к этому сообщению"
        :disabled="busy"
        @click="emit('rewind', turn.id)"
      >
        <ProjectorIcon name="undo-2" aria-hidden="true" />
      </UiButton>
      <UiButton
        shape="icon"
        size="sm"
        class="turn-action"
        title="Ответвить в новый чат: копия разговора до этого сообщения, текст останется в поле ввода"
        aria-label="Ответвить в новый чат"
        @click="emit('fork', turn.id, 'before')"
      >
        <ProjectorIcon name="git-fork" aria-hidden="true" />
      </UiButton>
    </UiInline>
    <div v-if="turn.form" class="user-form">
      <AgentFormAnswer
        ref="formAnswer"
        :source="turn.form.source"
        :values="turn.form.values"
        :busy="busy"
        :project-id="projectId"
        @submit="submitForm"
      />
    </div>
    <p v-else-if="turn.auto" class="user-message" :title="turn.auto">
      Фоновое задание<template v-if="turn.autoTitle"> «{{ turn.autoTitle }}»</template>
      завершилось. Проверь результат и скажи, что изменилось.
    </p>
    <p v-else class="user-message">
      <template v-if="turn.content?.length">
        <template v-for="(part, index) in turn.content" :key="index">
          <template v-if="isTextPart(part)">{{ part.text }}</template>
          <span
            v-else
            class="chip"
            :class="part.type"
            :title="chipTitle(part)"
            :data-chip="JSON.stringify(part)"
            role="button"
            tabindex="0"
            @click="emit('open', part)"
            @keydown.enter="emit('open', part)"
          >
            <span class="chip-icon" aria-hidden="true" v-html="chipIcon(part)" />{{
              chipLabel(part)
            }}</span
          >
        </template>
      </template>
      <template v-else>{{ turn.text }}</template>
    </p>
    <details v-if="turn.injected && !zenMode" class="injected">
      <summary>Возможности Projector</summary>
      <pre class="injected-text">{{ turn.injected }}</pre>
    </details>
  </div>
</template>

<style scoped>
.user-row {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
}
.turn-actions {
  min-height: var(--control-h-sm);
  opacity: 0;
  color: var(--muted);
}
.user-row:hover .turn-actions,
.turn-actions:focus-within,
.turn-actions.pinned {
  opacity: 1;
}
.versions {
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
}
.user-message {
  max-width: 90%;
  margin: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--bg-3);
  color: var(--text);
  font-size: var(--chat-fs);
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.user-form {
  width: min(90%, 640px);
  min-width: 0;
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-lg);
  background: var(--theme-raised-background, var(--bg-3));
}
.user-form :deep(.ui-card) {
  background: transparent;
}
.injected {
  max-width: 90%;
  margin: var(--sp-1) 0 0 auto;
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.injected > summary {
  cursor: pointer;
  list-style: none;
}
.injected > summary::-webkit-details-marker {
  display: none;
}
.injected[open] > summary {
  color: var(--muted);
}
.injected-text {
  max-height: 260px;
  margin: var(--sp-1) 0 0;
  padding: var(--sp-2);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--theme-inset-background, var(--bg-2));
  color: var(--muted);
  font-family: var(--mono);
  font-size: var(--fs-2xs);
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  background: var(--theme-inset-background, var(--bg-2));
  font-size: var(--fs-xs);
  line-height: 1.5;
  vertical-align: baseline;
}
.chip:hover,
.chip:focus-visible {
  border-color: var(--focus);
  color: var(--text);
  cursor: pointer;
}
.chip-icon {
  display: flex;
  color: var(--muted);
}
.chip-icon :deep(.chip-thumb) {
  border-radius: 2px;
  object-fit: cover;
}
.turn-time {
  align-self: center;
  font-size: var(--fs-2xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

@container (max-width: 500px) {
  .user-message {
    max-width: 96%;
  }
  .user-form {
    width: 100%;
  }
}
</style>
