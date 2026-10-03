<script setup lang="ts">
import IconBot from "~icons/lucide/bot";
import IconFiles from "~icons/lucide/files";
import IconGit from "~icons/lucide/git-branch";
import IconTerminal from "~icons/lucide/terminal";
import IconCornerDownLeft from "~icons/lucide/corner-down-left";

const emit = defineEmits<{ suggest: [text: string] }>();
const suggestions = [
  {
    title: "Разобраться в проекте",
    caption: "Структура и основные файлы",
    text: "Посмотри структуру проекта и расскажи, где находятся основные части приложения.",
    icon: IconFiles,
  },
  {
    title: "Посмотреть изменения",
    caption: "Что изменилось в Git",
    text: "Посмотри изменения в Git и кратко объясни, что изменилось. Ничего не меняй.",
    icon: IconGit,
  },
  {
    title: "Найти команду",
    caption: "Действия внутри Projector",
    text: "Какие команды Projector доступны для этого проекта?",
    icon: IconTerminal,
  },
];
</script>

<template>
  <div class="welcome">
    <div class="welcome-mark"><IconBot aria-hidden="true" /></div>
    <h1>С чего начнём?</h1>
    <p>Помогу разобраться в проекте<br />и выполнить нужные действия.</p>
    <div class="suggestions">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion.title"
        type="button"
        @click="emit('suggest', suggestion.text)"
      >
        <component :is="suggestion.icon" class="suggestion-icon" aria-hidden="true" />
        <span
          ><strong>{{ suggestion.title }}</strong
          ><small>{{ suggestion.caption }}</small></span
        >
        <IconCornerDownLeft class="suggestion-arrow" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  max-width: 490px;
  min-height: 100%;
  margin: auto;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 10px 0 26px;
  text-align: center;
}
.welcome-mark {
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  color: var(--text-2);
  margin-bottom: 23px;
}
.welcome-mark svg {
  width: 27px;
  height: 27px;
  stroke-width: 1.3;
}
h1 {
  font-size: var(--fs-xl);
  font-weight: 500;
  line-height: 1.3;
  letter-spacing: -0.04em;
  margin: 0 0 12px;
}
.welcome > p {
  color: var(--muted);
  font-size: var(--fs-xs);
  line-height: 1.9;
  margin: 0;
}
.suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 345px;
  margin-top: 30px;
}
.suggestions button {
  display: flex;
  align-items: center;
  gap: 13px;
  text-align: left;
  padding: 13px 15px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
  transition:
    border-color var(--t-fast),
    background var(--t-fast);
}
.suggestions button:hover {
  border-color: var(--line-strong);
  background: var(--bg-3);
}
.suggestion-icon {
  width: 17px;
  height: 17px;
  color: var(--muted);
  flex-shrink: 0;
}
.suggestions strong {
  display: block;
  font-size: var(--fs-2xs);
  font-weight: 500;
  color: var(--text);
}
.suggestions small {
  display: block;
  font-size: var(--fs-2xs);
  color: var(--muted);
  margin-top: 4px;
}
.suggestion-arrow {
  width: 13px;
  height: 13px;
  margin-left: auto;
  color: var(--faint);
  flex-shrink: 0;
}
@container (max-width: 500px) {
  h1 {
    font-size: var(--fs-lg);
  }
}
@container (max-width: 300px) {
  .suggestions button {
    padding: 11px;
  }
  .suggestions small {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .agent-chat *,
  .agent-chat *::before {
    animation: none;
    transition: none;
  }
}
</style>
