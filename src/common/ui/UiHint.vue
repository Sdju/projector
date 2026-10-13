<script setup lang="ts">
defineProps<{
  size?: "2xs" | "xs" | "sm";
  spaceAfter?: 2 | 3;
  spaceBefore?: 2;
  leading?: "theme" | "inherit";
  wrap?: boolean;
}>();
</script>

<template>
  <p
    class="hint"
    :class="{ wrap }"
    :style="{
      fontSize: size ? `var(--fs-${size})` : undefined,
      marginTop: spaceBefore ? `var(--sp-${spaceBefore})` : undefined,
      lineHeight: leading === 'inherit' ? 'inherit' : undefined,
      marginBottom: spaceAfter ? `var(--sp-${spaceAfter})` : undefined,
    }"
  >
    <slot />
  </p>
</template>

<style scoped>
.hint {
  margin: 0;
  color: var(--muted);
  font-size: var(--ui-hint-font-size, var(--fs-2xs));
  line-height: var(--lh);
}
.wrap {
  overflow-wrap: anywhere;
}
</style>
