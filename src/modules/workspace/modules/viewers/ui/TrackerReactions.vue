<script setup lang="ts">
import type { Reaction } from "../../../../../../core/modules/workspace/index.ts";
import {
  REACTION_EMOJI,
  REACTION_LABEL,
  useGithubEmojis,
} from "../../../../../common/utilities/github-emoji.ts";

/** Реакции под телом или комментарием: картинка эмодзи GitHub и счётчик. */
defineProps<{ reactions: Reaction[] }>();
const emojis = useGithubEmojis();
</script>

<template>
  <ul v-if="reactions.length" class="reactions" aria-label="Реакции">
    <li
      v-for="reaction in reactions"
      :key="reaction.content"
      :title="`${REACTION_LABEL[reaction.content]}: ${reaction.count}`"
    >
      <img
        v-if="emojis[REACTION_EMOJI[reaction.content]]"
        class="github-emoji"
        :src="emojis[REACTION_EMOJI[reaction.content]]"
        :alt="REACTION_LABEL[reaction.content]"
        loading="lazy"
      />
      <span v-else>{{ REACTION_LABEL[reaction.content] }}</span>
      {{ reaction.count }}
    </li>
  </ul>
</template>

<style scoped>
.reactions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  list-style: none;
  margin: var(--sp-2) 0 0;
  padding: 0;
}
.reactions li {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 1px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--text-2);
  font: var(--fs-2xs) var(--mono);
}
</style>
