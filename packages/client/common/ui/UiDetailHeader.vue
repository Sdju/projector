<script setup lang="ts">
import UiHeading from "./UiHeading.vue";
import UiInline from "./UiInline.vue";
import IconExternal from "~icons/lucide/external-link";

/** Shared top of a read-only detail tab: state pill, title, meta line and the host link. */
withDefaults(
  defineProps<{
    title?: string;
    state?: string;
    tone?: "neutral" | "success" | "warning" | "danger" | "accent";
    number?: string | number;
    subtitle?: string;
    externalHref?: string;
    host?: string;
  }>(),
  { tone: "neutral" },
);
</script>

<template>
  <UiInline as="header" class="head" align="baseline" wrap justify="normal">
    <span v-if="state" class="state" :class="tone">{{ state }}</span>
    <UiHeading as="h2" size="lg" weight="semibold" :space-after="0">
      <slot name="title">{{ title }}</slot>
      <span v-if="number !== undefined" class="number">#{{ number }}</span>
    </UiHeading>
  </UiInline>
  <p v-if="subtitle" class="subtitle" :title="subtitle">{{ subtitle }}</p>
  <UiInline as="p" class="meta" wrap>
    <slot name="meta" />
    <UiInline
      v-if="externalHref"
      as="a"
      inline
      :gap="1"
      justify="normal"
      class="external"
      :href="externalHref"
      target="_blank"
      rel="noopener noreferrer"
    >
      <IconExternal aria-hidden="true" />на {{ host }}
    </UiInline>
  </UiInline>
</template>

<style scoped>
.state {
  padding: 1px var(--sp-2);
  border-radius: var(--r-full);
  background: var(--active);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.state.success {
  background: color-mix(in srgb, var(--run) 22%, transparent);
  color: var(--run);
}
.state.warning {
  background: color-mix(in srgb, var(--warn) 22%, transparent);
  color: var(--warn);
}
.state.danger {
  background: color-mix(in srgb, var(--err) 22%, transparent);
  color: var(--err);
}
.state.accent {
  background: color-mix(in srgb, var(--accent) 22%, transparent);
  color: var(--accent);
}
.number {
  color: var(--muted);
  font: var(--fs-xs) var(--mono);
}
.subtitle {
  margin: var(--sp-1) 0 0;
  color: var(--muted);
  font: var(--fs-2xs) var(--mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  margin: var(--sp-2) 0 0;
  color: var(--muted);
  font-size: var(--fs-xs);
}
.external {
  color: var(--text-2);
}
.external svg {
  width: 13px;
  height: 13px;
}
</style>
