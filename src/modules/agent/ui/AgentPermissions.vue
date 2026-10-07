<script setup lang="ts">
import UiButton from "../../../common/ui/UiButton.vue";
import type { AgentPermission } from "../model/types.ts";
import IconShield from "~icons/lucide/shield-question";

defineProps<{ permissions: AgentPermission[] }>();
const emit = defineEmits<{ decide: [id: string, allow: boolean] }>();
</script>

<template>
  <div
    v-if="permissions.length"
    class="permissions"
    role="alertdialog"
    aria-label="Запрос разрешения"
  >
    <section v-for="item in permissions" :key="item.id" class="permission">
      <header>
        <IconShield aria-hidden="true" />
        <span class="title">{{ item.title }}</span>
        <code class="tool">{{ item.tool }}</code>
      </header>
      <pre v-if="item.detail">{{ item.detail }}</pre>
      <div class="actions">
        <UiButton variant="solid" size="sm" @click="emit('decide', item.id, true)">
          Разрешить
        </UiButton>
        <UiButton variant="ghost" size="sm" @click="emit('decide', item.id, false)">
          Отклонить
        </UiButton>
      </div>
    </section>
  </div>
</template>

<style scoped>
.permissions {
  display: grid;
  gap: 8px;
  margin: 0 0 10px;
}
.permission {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--warn) 40%, var(--bg-2));
  border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--warn) 8%, var(--bg-2));
  font-size: var(--fs-2xs);
}
header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
header svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--warn);
}
.title {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text);
}
.tool {
  margin-left: auto;
  color: var(--muted);
  font-family: var(--mono);
}
pre {
  margin: 0;
  max-height: 160px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: var(--r-md);
  background: var(--bg-sunken);
  color: var(--text-2);
  font: var(--fs-2xs) / 1.6 var(--mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.actions {
  display: flex;
  gap: 8px;
}
</style>
