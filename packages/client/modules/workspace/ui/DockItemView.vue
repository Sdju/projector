<script setup lang="ts">
import { computed, inject } from "vue";
import ProjectorIcon from "../../../common/icons/ProjectorIcon.vue";
import UiButton from "../../../common/ui/UiButton.vue";
import { AgentInboxBell } from "../../agent/index.ts";
import { DOCK_ACTION_DELEGATES, type DockItem } from "../lib/dock-items.ts";

const props = defineProps<{ item: DockItem }>();
const delegates = inject(DOCK_ACTION_DELEGATES);
const delegate = computed(() =>
  props.item.action ? delegates?.value.get(props.item.action.id) : undefined,
);
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
</script>

<template>
  <component
    v-if="delegate"
    :is="delegate.component"
    v-bind="delegate.props?.()"
    @command="(id: string, args?: unknown) => emit('command', id, args)"
  />
  <AgentInboxBell
    v-else-if="item.action?.id === 'inbox'"
    v-if="item.action?.id === 'inbox'"
    scope-id="inbox:dock"
    @open="emit('command', 'ide.workbench.inbox.open')"
  />
  <UiButton
    v-else-if="item.action"
    shape="icon"
    size="sm"
    :title="item.title"
    :aria-label="item.title"
    :data-command="item.action.command"
    @click="emit('command', item.action.command)"
  >
    <ProjectorIcon :name="item.icon" aria-hidden="true" />
  </UiButton>
  <component v-else :is="item.component!" v-bind="item.props" />
</template>
