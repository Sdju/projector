<script setup lang="ts">
/** Standalone native label; control identity and form layout stay with the owner. */
const props = defineProps<{
  for?: string;
  as?: "label" | "span";
  inline?: boolean;
  size?: "2xs" | "xs" | "sm";
  tone?: "muted" | "secondary";
  spaceBefore?: 4;
  spaceAfter?: 2;
}>();
</script>

<template>
  <component
    :is="as ?? 'label'"
    class="ui-label"
    :for="as === 'span' ? undefined : props.for"
    :style="{
      display: inline ? 'inline' : undefined,
      fontSize: size ? `var(--fs-${size})` : undefined,
      color: tone === 'muted' ? 'var(--muted)' : tone === 'secondary' ? 'var(--text-2)' : undefined,
      marginTop: spaceBefore ? `var(--sp-${spaceBefore})` : undefined,
      marginBottom: spaceAfter ? `var(--sp-${spaceAfter})` : undefined,
    }"
    ><slot
  /></component>
</template>

<style scoped>
.ui-label {
  display: block;
  margin: 0;
}
</style>
