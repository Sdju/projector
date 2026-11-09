<script setup lang="ts">
const props = defineProps<{
  items: { label: string; value: number; share: number }[];
  format?: (value: number) => string;
  ariaLabel?: string;
}>();

const format = (value: number) => props.format?.(value) ?? String(value);
const width = (share: number) => `${Math.max(1, Math.min(100, share * 100))}%`;
</script>

<template>
  <ul class="breakdown" :aria-label="ariaLabel">
    <li v-for="item in items" :key="item.label">
      <div class="head">
        <span class="label">{{ item.label }}</span>
        <span class="value">{{ format(item.value) }}</span>
      </div>
      <div class="track"><i :style="{ width: width(item.share) }" /></div>
    </li>
  </ul>
</template>

<style scoped>
.breakdown {
  display: grid;
  gap: var(--sp-2);
  margin: 0;
  padding: 0;
  min-width: 0;
  list-style: none;
}
li {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--sp-3);
  font-size: var(--fs-2xs);
}
.label {
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}
.track {
  height: 5px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--bg-sunken);
}
.track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--info) 72%, var(--line));
}
</style>
