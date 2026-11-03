<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { SettingsWorkbench, type SettingsReadoutState } from "../settings/index.ts";
import { readoutLines } from "../../common/utilities/tab-readout.ts";
import { formatBalance, providerOf, providerSection, useProviders } from "../provider/index.ts";
import { settingsSections } from "./sections.ts";
const props = defineProps<{ selected?: string; embedded?: boolean }>();
const emit = defineEmits<{ select: [id: string] }>();
const selection = ref("interface");
const current = computed(() => props.selected ?? selection.value);
function select(id: string) {
  selection.value = id;
  emit("select", id);
}

// Each provider is a page of its own under "Модели и провайдеры", like scenarios in project settings.
const { providers, activeProviderId, balances, revision, load, loadBalances } = useProviders();
onMounted(() => void load());
// Balances follow every load or save, so a freshly saved key shows its balance right away.
watch(revision, () => void loadBalances());
const sections = computed(() =>
  settingsSections.map((section) =>
    section.id !== "providers"
      ? section
      : {
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
        },
  ),
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
