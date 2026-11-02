<script setup lang="ts">
import { computed, ref, useId, type ComponentPublicInstance } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiHint from "../../../common/ui/UiHint.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import UiStack from "../../../common/ui/UiStack.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import {
  JUDGE_DEFAULTS,
  normalizeJudgeOverride,
  resolveJudgeSettings,
  type JudgeOverride,
  type JudgeSettings,
} from "../../../../core/modules/agent-judge/index.ts";
import { readJudgeSettings } from "../api/judge.ts";
import AgentJudgeFields from "./AgentJudgeFields.vue";

/**
 * Judge settings of one chat: the chat's own values start from the global ones and are saved with
 * the chat. Reset drops the override, so later global changes apply again.
 */
const props = defineProps<{
  chat: string;
  /** The chat's own settings; undefined means the global ones. */
  override?: JudgeOverride;
  /** The chat is still loading: its saved choice would replace a toggle made now. */
  disabled?: boolean;
  /** Another control opens the island: keep the header button out of the layout. */
  showTrigger?: boolean;
  /** The island opens next to this element when the header no longer has its own trigger. */
  anchor?: () => HTMLElement | undefined;
}>();
const emit = defineEmits<{ "update:override": [value: JudgeOverride | undefined] }>();

const global = ref<JudgeSettings>({ ...JUDGE_DEFAULTS });
const draft = ref<JudgeSettings>({ ...JUDGE_DEFAULTS });
const error = ref("");
const overridden = computed(() => props.override !== undefined);
const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["input:not(:disabled)", "select:not(:disabled)", "button:not(:disabled)"],
  items: "input, select, button",
  returnFocus: ".trigger, button",
});
const ownTrigger = ref<HTMLElement>();
function bindTrigger(element: Element | ComponentPublicInstance | null) {
  ownTrigger.value = element instanceof HTMLElement ? element : undefined;
}
const commands = useCommandScope(`agent-judge-chat:${useId()}`, () => ({
  surface: "agentJudgeChat",
  chat: props.chat,
  overridden: overridden.value,
  show: draft.value.show,
  auto: draft.value.auto,
  maxRisk: draft.value.maxRisk,
  confidence: draft.value.confidence,
}));

function adopt(settings: JudgeSettings) {
  draft.value = { ...settings };
}

/** The fields emit a new object after every change; the chat saves it as its override. */
function apply(settings: JudgeSettings) {
  draft.value = settings;
  if (!props.disabled) emit("update:override", { ...settings });
}

async function reload() {
  try {
    global.value = await readJudgeSettings();
    error.value = "";
    adopt(resolveJudgeSettings(global.value, props.override));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Не удалось прочитать настройки";
  }
}

function reset() {
  emit("update:override", undefined);
  adopt(global.value);
}

function openAt(anchor?: HTMLElement) {
  menu.trigger.value = anchor ?? props.anchor?.() ?? ownTrigger.value;
  if (!menu.open.value) void reload();
  commands.scope.activate();
  menu.toggle(true);
}
function open() {
  openAt();
}
defineExpose({ openAt });

function updateOverride(value: unknown) {
  if (props.disabled) throw new Error("Чат ещё загружается: настройки Судьи пока недоступны");
  const next = normalizeJudgeOverride(value);
  emit("update:override", next);
  adopt(resolveJudgeSettings(global.value, next));
  return { overridden: next !== undefined, ...resolveJudgeSettings(global.value, next) };
}

commands.scope.registerCommand({
  id: "ide.agent.judge.chat.get",
  title: "Прочитать настройки Судьи текущего чата",
  description:
    "Возвращает настройки Projector Judge для этого чата с учётом глобальных: show, auto, maxRisk, confidence и overridden — есть ли у чата собственное переопределение.",
  run: async () => {
    await reload();
    return { chat: props.chat, overridden: overridden.value, ...draft.value };
  },
});
commands.scope.registerCommand({
  id: "ide.agent.judge.chat.set",
  title: "Настроить Судью для текущего чата",
  description:
    "Переопределяет настройки Projector Judge для этого чата, не меняя глобальные. Передайте хотя бы одно поле; maxRisk выше 3 запрещён.",
  arguments: {
    show: "boolean: показывать оценку",
    auto: "boolean: разрешать низкий риск автоматически",
    maxRisk: "1, 2 или 3",
    confidence: "high или high-medium",
  },
  run: (value) => {
    const args = commandArgs(value);
    return updateOverride({
      ...draft.value,
      ...(typeof args.show === "boolean" ? { show: args.show } : {}),
      ...(typeof args.auto === "boolean" ? { auto: args.auto } : {}),
      ...(args.maxRisk !== undefined ? { maxRisk: args.maxRisk } : {}),
      ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
    });
  },
});
commands.scope.registerCommand({
  id: "ide.agent.judge.chat.reset",
  title: "Вернуть настройки Судьи чата к глобальным",
  description: "Убирает переопределение Projector Judge у этого чата.",
  run: () => {
    reset();
    return { overridden: false, ...global.value };
  },
});
commands.scope.registerCommand({
  id: "ide.agent.judge.panel",
  title: "Открыть настройки Судьи",
  description:
    "Открывает или закрывает остров Projector Judge в табе агента: показывать ли оценку риска, разрешать ли низкий риск автоматически и до какого балла.",
  run: () => open(),
});
</script>

<template>
  <div :ref="bindTrigger" class="judge-island" :class="{ hidden: showTrigger === false }">
    <button
      v-if="showTrigger !== false"
      type="button"
      class="trigger"
      :class="{ changed: overridden }"
      :aria-expanded="menu.open.value"
      :aria-controls="menu.id"
      aria-label="Судья"
      title="Судья"
      @click="open"
    >
      <span aria-hidden="true">⚖</span>
      <span v-if="overridden" class="changed-dot" aria-hidden="true" />
    </button>
  </div>
  <UiIsland :menu="menu" label="Судья" :width="360">
    <UiIslandLabel>Судья</UiIslandLabel>
    <UiStack :gap="3">
      <AgentJudgeFields :model-value="draft" :disabled="disabled" @update:model-value="apply" />
      <UiHint>
        Баллы 4–5 не разрешаются автоматически. «Сбросить» возвращает чат к глобальным настройкам.
      </UiHint>
      <UiButton v-if="overridden" :disabled="disabled" @click="reset">Как по умолчанию</UiButton>
      <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    </UiStack>
  </UiIsland>
</template>

<style scoped>
.judge-island {
  display: contents;
}
.trigger {
  position: relative;
}
.changed-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--run);
}
</style>
