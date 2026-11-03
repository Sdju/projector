<script setup lang="ts">
/** Section/dialog typography. Choose the native level independently of its visual size. */
defineProps<{
  as?: "h1" | "h2" | "h3";
  size?: "sm" | "md" | "lg";
  spaceAfter?: 0 | 2 | 3 | 4;
  spaceBefore?: 0 | 2 | 3 | 4;
  weight?: "medium" | "semibold";
  tone?: "secondary";
}>();
</script>

<template>
  <component
    :is="as ?? 'h2'"
    class="ui-heading"
    :class="{
      small: size === 'sm',
      large: size === 'lg',
      semibold: weight === 'semibold',
      secondary: tone === 'secondary',
    }"
    :style="
      spaceAfter === undefined && spaceBefore === undefined
        ? undefined
        : {
            marginBottom:
              spaceAfter === undefined
                ? undefined
                : spaceAfter === 0
                  ? '0'
                  : `var(--sp-${spaceAfter})`,
            marginTop:
              spaceBefore === undefined
                ? undefined
                : spaceBefore === 0
                  ? '0'
                  : `var(--sp-${spaceBefore})`,
          }
    "
    ><slot
  /></component>
</template>

<style scoped>
.ui-heading {
  margin: 0 0 var(--sp-3);
  font-size: var(--fs-md);
  font-weight: 500;
}
.small {
  font-size: var(--fs-sm);
}
.large {
  font-size: var(--fs-lg);
}
.semibold {
  font-weight: 600;
}
.secondary {
  color: var(--text-2);
}
</style>
