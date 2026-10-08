<script setup lang="ts">
withDefaults(defineProps<{ plain?: boolean; agentName?: string }>(), {
  plain: false,
  agentName: "Агент",
});
const emit = defineEmits<{ suggest: [text: string] }>();
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
.suggestions button:hover {
  border-color: var(--line-strong);
  color: var(--text);
}
</style>
