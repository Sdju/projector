<script setup lang="ts">
import { ref, VWindow, VBox, VButton, VLabel, VEntry, VSeparator } from "vio";
const count = ref(0);
const name = ref("Vue + GTK");
const props = defineProps<{ quit: () => void }>();
function close() { props.quit(); return true; }
</script>

<template>
  <VWindow title="vio · Vue + GTK4" :default-width="400" :default-height="240" :visible="true" @close-request="close">
    <VBox orientation="vertical" :spacing="12" :margin-top="24" :margin-bottom="24" :margin-start="24" :margin-end="24">
      <VEntry v-model="name" placeholder-text="Название" />
      <VLabel class="heading">{{ name }} · {{ count }}</VLabel>
      <VSeparator />
      <VButton @clicked="count++">Увеличить счётчик</VButton>
      <VLabel v-if="count > 0">Обновляется обычной реактивностью Vue</VLabel>
    </VBox>
  </VWindow>
</template>

<style scoped>
.heading { font-size: 22px; }
</style>
