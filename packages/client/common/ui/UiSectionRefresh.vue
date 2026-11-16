<script lang="ts">
import { type ComputedRef, type InjectionKey } from "vue";

/** Host of a sidebar section: the in-flow refresh button calls this instead of an overlay. */
export interface SectionRefresh {
  readonly refreshing: ComputedRef<boolean>;
  readonly command: ComputedRef<string>;
  run(): void;
}

export const sectionRefreshKey: InjectionKey<SectionRefresh> = Symbol("section-refresh");
</script>

<script setup lang="ts">
import { computed, inject } from "vue";
import UiButton from "./UiButton.vue";
import IconRefresh from "~icons/lucide/rotate-cw";

const host = inject(sectionRefreshKey, null);
const refreshing = computed(() => host?.refreshing.value ?? false);
const command = computed(() => host?.command.value ?? "");
</script>

<template>
  <UiButton
    v-if="host"
    shape="icon"
    size="sm"
    title="Обновить раздел"
    :aria-label="refreshing ? 'Обновление раздела' : 'Обновить раздел'"
    :data-command="command"
    :busy="refreshing"
    @click="host.run()"
  >
    <IconRefresh aria-hidden="true" />
  </UiButton>
</template>
