<script setup lang="ts">
import UiMessage from "./UiMessage.vue";
import UiStack from "./UiStack.vue";

/**
 * Settings form shell: one column, command-scope activation on focus and a single error line.
 * Sections own their fields and actions; the shell only keeps the surrounding contract equal.
 */
defineProps<{ activate?: () => void; error?: string }>();
</script>

<template>
  <UiStack as="section" :gap="4" @focusin="activate?.()" @pointerdown="activate?.()">
    <slot />
    <UiMessage v-if="error" tone="danger" size="xs" flush role="alert">{{ error }}</UiMessage>
  </UiStack>
</template>
