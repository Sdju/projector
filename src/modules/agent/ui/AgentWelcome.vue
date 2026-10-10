<script setup lang="ts">
import { guiPrograms } from "../model/modes.ts";
withDefaults(defineProps<{ plain?: boolean; agentName?: string }>(), {
  plain: false,
  agentName: "Агент",
});
const emit = defineEmits<{ suggest: [text: string]; open: [program: string] }>();
const coders = Object.entries(guiPrograms);
const suggestions = [
  {
    title: "Разобраться в проекте",
    text: "Посмотри структуру проекта и расскажи, где находятся основные части приложения.",
  },
  {
    title: "Посмотреть изменения в Git",
    text: "Посмотри изменения в Git и кратко объясни, что изменилось. Ничего не меняй.",
  },
  {
    title: "Найти команду Projector",
    text: "Какие команды Projector доступны для этого проекта?",
  },
];
</script>

<template>
  <div class="welcome">
    <h1>{{ plain ? agentName : "С чего начнём?" }}</h1>
    <p v-if="plain">Работает в папке проекта, как в терминале.</p>
    <div v-else class="suggestions">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion.title"
        type="button"
        @click="emit('suggest', suggestion.text)"
      >
        {{ suggestion.title }}
      </button>
    </div>
    <div v-if="!plain" class="coders">
      <span class="coders-label" title="Я управляю Projector и не пишу код в файлах">
        Писать код — в агенте
      </span>
      <div class="coders-list">
        <button v-for="[id, program] in coders" :key="id" type="button" @click="emit('open', id)">
          {{ program.title }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  max-width: 420px;
  min-height: 100%;
  margin: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: var(--sp-4) 0 var(--sp-6);
  text-align: center;
}
h1 {
  font-size: var(--fs-md);
  font-weight: 500;
  margin: 0 0 var(--sp-2);
}
.welcome > p {
  color: var(--muted);
  font-size: var(--fs-xs);
  margin: 0;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-2);
  margin-top: var(--sp-2);
}
.coders {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-6);
  padding-top: var(--sp-4);
  border-top: 1px solid var(--line);
  width: 100%;
}
.coders-label {
  color: var(--faint);
  font-size: var(--fs-2xs);
}
.coders-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--sp-1);
}
.coders button,
.suggestions button {
  padding: var(--sp-1) var(--sp-3);
  border: 1px solid var(--line);
  border-radius: var(--r-full);
  color: var(--muted);
  font-size: var(--fs-xs);
  transition:
    border-color var(--t-fast),
    color var(--t-fast);
}
.coders button:hover,
.suggestions button:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
</style>
