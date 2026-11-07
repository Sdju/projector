<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { SettingsWorkbench, type SettingsReadoutState } from "../settings/index.ts";
import { readoutLines } from "../../common/utilities/tab-readout.ts";
import { formatBalance, providerOf, providerSection, useProviders } from "../provider/index.ts";
import { agentOf, agentSection, useAgentModes } from "../agent/index.ts";
import { clientAgents } from "../agents-integration/catalog/index.ts";
import { settingsSections } from "./sections.ts";
const props = defineProps<{ selected?: string; embedded?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const selection = ref("interface");
// Pages that became one adapter page; old links and restored tabs open the new section.
const legacySections: Record<string, string> = {
  "agent-integrations": "agents",
  "agent-sessions": "agents",
  "agent-features": "agents",
};
const current = computed(() => {
  const id = props.selected ?? selection.value;
  return legacySections[id] ?? id;
});
function select(id: string) {
  selection.value = id;
  emit("select", id);
}

// Each provider is a page of its own under "Модели и провайдеры", like scenarios in project settings.
const { providers, activeProviderId, balances, revision, load, loadBalances } = useProviders();
const { isEnabled, modeOf } = useAgentModes();
onMounted(() => void load());
// Balances follow every load or save, so a freshly saved key shows its balance right away.
watch(revision, () => void loadBalances());
const sections = computed(() =>
  settingsSections.map((section) => {
    if (section.id === "providers")
      return {
        ...section,
        props: {
          providerId: providerOf(current.value),
          onOpen: (id?: string) => select(id ? providerSection(id) : "providers"),
        },
        items: providers.value.map((item) => {
          const balance = balances.value[item.id];
          return {
            id: providerSection(item.id),
            title: item.name.trim() || "без названия",
            hint: !item.enabled
              ? "выкл"
              : balance?.status === "ready"
                ? formatBalance(balance.entries)
                : item.id === activeProviderId.value
                  ? "по умолчанию"
                  : undefined,
            problem: !item.url.trim() || (item.enabled && item.models.length === 0),
          };
        }),
      };
    if (section.id !== "agents") return section;
    const agents = clientAgents();
    return {
      ...section,
      // Adapter names are pages of this section, so search finds them here rather than nowhere.
      keywords: `${section.keywords} ${agents
        .map((agent) => `${agent.title} ${agent.backend} ${agent.program}`)
        .join(" ")}`,
      props: {
        agentId: agentOf(current.value),
        onOpen: (id?: string) => select(id ? agentSection(id) : "agents"),
      },
      items: agents.map((agent) => ({
        id: agentSection(agent.backend),
        title: agent.title,
        hint: agent.builtin
          ? "встроенный"
          : !isEnabled(agent.program)
            ? "выкл"
            : modeOf(agent.program) === "gui"
              ? "чат"
              : undefined,
      })),
    };
  }),
);

// Что штатный агент видит во вкладке настроек Projector.
const readout = (state: SettingsReadoutState) => ({
  note: "Настройки Projector",
  text: readoutLines(
    `Раздел: ${state.sectionTitle || state.section || "—"}`,
    state.query ? `Поиск: «${state.query}»` : "",
    `Видимых разделов: ${state.visible}`,
  ),
});
</script>
<template>
  <SettingsWorkbench
    :sections="sections"
    :selected="current"
    :embedded="embedded"
    :read="readout"
    @select="select"
  />
</template>
