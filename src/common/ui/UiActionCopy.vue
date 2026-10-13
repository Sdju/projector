<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    grow?: boolean;
    description?: string;
    descriptionMode?: "truncate" | "wrap";
    descriptionTone?: "muted" | "secondary";
    mono?: boolean;
    emphasized?: boolean;
    truncateTitle?: boolean;
  }>(),
  { grow: true },
);
</script>

<template>
  <span class="copy" :class="{ intrinsic: !grow }">
    <span class="name" :class="{ emphasized, 'u-truncate': truncateTitle }">{{ title }}</span>
    <span
      v-if="description"
      class="caption"
      :class="[
        descriptionMode === 'wrap' ? 'wrap' : 'u-truncate',
        { secondary: descriptionTone === 'secondary', mono },
      ]"
      >{{ description }}</span
    >
  </span>
</template>

<style scoped>
.copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.name {
  font-size: var(--fs-sm);
}
.emphasized {
  color: var(--text);
  font-weight: 600;
}
.caption {
  color: var(--muted);
  font-size: var(--fs-2xs);
}

.wrap {
  line-height: 1.4;
}
.secondary {
  color: var(--text-2);
}
.mono {
  font-family: var(--mono);
}
.intrinsic {
  flex: 0 1 auto;
}
</style>
