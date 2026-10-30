<script setup lang="ts">
import { computed, onMounted, useId } from "vue";
import UiButton from "../../../common/ui/UiButton.vue";
import UiControl from "../../../common/ui/UiControl.vue";
import UiIsland from "../../../common/ui/UiIsland.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiMessage from "../../../common/ui/UiMessage.vue";
import { useIslandMenu } from "../../../common/utilities/island-menu.ts";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { loadAgentFeatures, useAgentFeatureCatalog } from "../model/catalog.ts";
import IconSparkles from "~icons/lucide/sparkles";

/**
 * The abilities of one chat: every feature the tab's agent can have, with the chat's own choice.
 * Values without an override come from the global defaults from the settings.
 */
const props = defineProps<{
  backend: string;
  chat: string;
  /** Feature ids chosen for this chat; undefined means the global defaults. */
  overrides?: string[];
  /** The chat is still loading: its saved choice would replace a toggle made now. */
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:overrides": [value: string[] | undefined] }>();

const { data, error: loadError } = useAgentFeatureCatalog();
const uid = useId();
const error = computed(() => loadError.value);
const defaults = computed(
  () =>
    new Set(
      data.value.features
        .filter((feature) => feature.agents.find((agent) => agent.id === props.backend)?.enabled)
        .map((feature) => feature.id),
    ),
);
const overridden = computed(() => props.overrides !== undefined);
const effective = (feature: string) =>
  props.overrides ? props.overrides.includes(feature) : defaults.value.has(feature);

const menu = useIslandMenu({
  anchor: "right",
  initialFocus: ["input:not(:disabled)", "button:not(:disabled)"],
  items: "input, button",
  returnFocus: ".trigger",
});
const commands = useCommandScope(`agent-features:${useId()}`, () => ({
  surface: "agentFeatures",
  backend: props.backend,
  chat: props.chat,
  overridden: overridden.value,
  features: data.value.features.length,
}));

async function reload() {
  try {
    await loadAgentFeatures(true);
  } catch {
    // The island shows the catalog error; a command that failed rejects to its caller.
  }
}

async function setFeature(featureId: string, enabled: boolean) {
  if (props.disabled) throw new Error("Чат ещё загружается: выбор возможностей пока недоступен");
  const catalog = await loadAgentFeatures();
  const feature = catalog.features.find((item) => item.id === featureId);
  if (!feature) throw new Error(`Неизвестная возможность: ${featureId}`);
  const current = props.overrides ?? [...defaults.value];
  const next = enabled
    ? [...new Set([...current, featureId])]
    : current.filter((id) => id !== featureId);
  const same = next.length === defaults.value.size && next.every((id) => defaults.value.has(id));
  emit("update:overrides", same ? undefined : next);
  return { feature: featureId, enabled, overridden: !same, overrides: same ? undefined : next };
}

function reset() {
  if (props.disabled) throw new Error("Чат ещё загружается: выбор возможностей пока недоступен");
  emit("update:overrides", undefined);
}

commands.scope.registerCommand({
  id: "ide.agent.features.chat.list",
  palette: false,
  title: "Список возможностей текущего чата",
  description:
    "Возвращает возможности выбранного агента в этом чате: id, название, описание, включена ли возможность сейчас (enabled) и включена ли она по умолчанию (default). overridden показывает, есть ли у чата собственный выбор.",
  run: async () => {
    const catalog = await loadAgentFeatures();
    return {
      backend: props.backend,
      chat: props.chat,
      overridden: overridden.value,
      features: catalog.features.map((feature) => ({
        id: feature.id,
        title: feature.title,
        summary: feature.summary,
        enabled: effective(feature.id),
        default: defaults.value.has(feature.id),
      })),
    };
  },
});
commands.scope.registerCommand({
  id: "ide.agent.features.chat.set",
  palette: false,
  title: "Включить или выключить возможность в текущем чате",
  description:
    "Переопределяет возможность (widgets — виджеты в ответах, ide — команды IDE через MCP) для этого чата, не меняя умолчание агента в настройках. Часть агентов применяет изменение со следующего сообщения, часть — в новой сессии.",
  arguments: {
    feature: "string: id возможности: widgets или ide",
    enabled: "boolean: включена ли возможность в этом чате",
  },
  run: (value) => {
    const args = commandArgs(value);
    if (typeof args.feature !== "string" || !args.feature)
      throw new Error("feature: id возможности: widgets или ide");
    if (typeof args.enabled !== "boolean") throw new Error("enabled должен быть boolean");
    return setFeature(args.feature, args.enabled);
  },
});
commands.scope.registerCommand({
  id: "ide.agent.features.chat.reset",
  title: "Вернуть возможности чата к умолчаниям",
  description:
    "Убирает собственный выбор возможностей у этого чата: дальше действуют умолчания агента из глобальных настроек.",
  run: () => {
    reset();
    return { overridden: false };
  },
});
commands.scope.registerCommand({
  id: "ide.agent.features.panel",
  title: "Открыть возможности агента",
  description:
    "Открывает или закрывает остров возможностей в табе агента: какие необязательные возможности (виджеты в ответах, команды IDE через MCP) включены в этом чате и чем они отличаются от умолчаний.",
  run: () => open(),
});

function open() {
  if (!menu.open.value) void reload();
  commands.scope.activate();
  menu.toggle();
}
function change(featureId: string, event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  void setFeature(featureId, enabled).catch(() => undefined);
}
onMounted(() => void loadAgentFeatures().catch(() => undefined));
</script>

<template>
  <div :ref="(element) => (menu.trigger.value = element as HTMLElement)" class="features">
    <button
      type="button"
      class="trigger"
      :class="{ changed: overridden }"
      :aria-expanded="menu.open.value"
      :aria-controls="menu.id"
      aria-label="Возможности агента"
      title="Возможности агента"
      @click="open"
    >
      <IconSparkles aria-hidden="true" />
      <span v-if="overridden" class="changed-dot" aria-hidden="true" />
    </button>
  </div>
  <UiIsland :menu="menu" label="Возможности агента" :width="340">
    <UiIslandLabel>Возможности агента</UiIslandLabel>
    <section v-for="feature in data.features" :key="feature.id" class="feature">
      <label class="agent">
        <UiControl
          type="checkbox"
          :id="`${uid}-${feature.id}`"
          :name="feature.id"
          :checked="effective(feature.id)"
          :disabled="disabled"
          :aria-label="feature.title"
          @change="change(feature.id, $event)"
        />
        <span class="feature-title">{{ feature.title }}</span>
      </label>
    </section>
    <p v-if="!data.features.length" class="empty">Возможностей пока нет.</p>
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
    <div v-if="overridden" class="footer">
      <UiButton size="sm" :disabled="disabled" @click="reset">Как по умолчанию</UiButton>
    </div>
  </UiIsland>
</template>

<style scoped>
.features {
  display: inline-flex;
}
.trigger {
  position: relative;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border: 0;
  border-radius: var(--r-sm);
  background: none;
  color: var(--muted);
  cursor: pointer;
}
.trigger:hover,
.trigger[aria-expanded="true"] {
  background: var(--hover);
  color: var(--text);
}
.trigger.changed {
  color: var(--accent, var(--text));
}
.trigger svg {
  width: 14px;
  height: 14px;
}
.changed-dot {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 5px;
  height: 5px;
  border-radius: var(--r-full);
  background: currentColor;
}
.feature {
  border-top: 1px solid var(--line);
}
.empty {
  margin: 0;
  padding: var(--sp-2);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.agent {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  padding: var(--sp-2);
  cursor: pointer;
}
.feature-title {
  color: var(--text);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.footer {
  display: flex;
  padding: var(--sp-1) var(--sp-2);
}
.hint {
  margin: 0;
  padding: 0 var(--sp-2) var(--sp-1);
  color: var(--faint);
  font-size: var(--fs-2xs);
}
</style>
