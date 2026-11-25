<script setup lang="ts">
import { computed, inject } from "vue";
import { DOCK_CELLS, useDockCatalog } from "../lib/dock-items.ts";
import DockItemView from "./DockItemView.vue";

const props = withDefaults(defineProps<{ inbox?: boolean; mobile?: boolean }>(), { inbox: true });
const emit = defineEmits<{ command: [id: string, args?: unknown] }>();
const catalog = useDockCatalog();
const cells = inject(DOCK_CELLS);
const items = computed(() => catalog.available(props.inbox));
const detached = (item: (typeof items.value)[number]) =>
  props.mobile || catalog.layout.isHidden(item.id);
const target = (id: string) => cells?.value.get(id);
</script>

<template>
  <Teleport
    v-for="item in items"
    :key="item.id"
    :to="target(item.id) ?? 'body'"
    :disabled="detached(item) || !target(item.id)"
  >
    <div :hidden="detached(item) || !target(item.id)">
      <DockItemView :item="item" @command="(id, args) => emit('command', id, args)" />
    </div>
  </Teleport>
</template>
