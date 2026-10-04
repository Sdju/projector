<script setup lang="ts">
import { ref, VWindow, VBox, VEntry, VLabel, VButton, VKeyController } from "vio";
const text = ref("initial");
const count = ref(0);
const entry = ref();
const button = ref();
defineExpose({ text, count, entry, button });
</script>
<template>
  <VWindow :visible="false">
    <VKeyController propagation-phase="capture" @key-pressed="() => true" />
    <VBox orientation="vertical">
      <VEntry ref="entry" v-model="text" />
      <VLabel class="heading">{{ text }} · {{ count }}</VLabel>
      <VButton ref="button" @clicked="count++">increment</VButton>
    </VBox>
  </VWindow>
</template>
<style scoped>
.heading {
  font-size: 22px;
}
</style>
