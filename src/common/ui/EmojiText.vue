<script setup lang="ts">
import { computed } from "vue";
import { splitEmoji, useGithubEmojis } from "../utilities/github-emoji.ts";

/** Текст, в котором шорткоды GitHub (`:tada:`) заменены картинками эмодзи. */
const props = defineProps<{ text: string }>();
const emojis = useGithubEmojis();
const parts = computed(() => splitEmoji(props.text, emojis.value));
</script>

<template>
  <template v-for="(part, index) in parts" :key="index"
    ><img
      v-if="typeof part !== 'string'"
      class="github-emoji"
      :src="part.url"
      :alt="`:${part.name}:`"
      :title="`:${part.name}:`"
      loading="lazy"
    /><template v-else>{{ part }}</template></template
  >
</template>

<style>
.github-emoji {
  display: inline-block;
  width: 1.2em;
  height: 1.2em;
  vertical-align: -0.2em;
}
</style>
