<script setup lang="ts">
import UiSkeleton from "../../../common/ui/UiSkeleton.vue";
import UiSpinner from "../../../common/ui/UiSpinner.vue";

/** Каркас рабочей области, пока проект открывается: раскладка не прыгает, когда приходят данные. */
const rows = ["62%", "48%", "70%", "54%", "66%", "44%", "58%"];
</script>

<template>
  <section class="opening" role="status" aria-live="polite">
    <div class="rail"><UiSkeleton v-for="n in 6" :key="n" width="18px" height="18px" /></div>
    <div class="side">
      <UiSkeleton v-for="width in rows" :key="width" :width="width" height="10px" />
    </div>
    <div class="editor" />
    <div class="terminal" />
    <p class="label"><UiSpinner /> Открываю проект…</p>
  </section>
</template>

<style scoped>
.opening {
  position: relative;
  display: grid;
  grid-template-columns: 40px 240px 1fr 340px;
  gap: var(--sp-2);
  flex: 1;
  min-height: 0;
  padding: var(--sp-2);
}
.rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--sp-4);
  padding-top: var(--sp-3);
}
.side {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
  padding: var(--sp-3);
}
.editor,
.terminal {
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: var(--bg-2);
}
.label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  margin: 0;
  color: var(--muted);
  font-size: var(--fs-xs);
  pointer-events: none;
}
.label svg {
  width: 14px;
  height: 14px;
}
@media (max-width: 700px) {
  .opening {
    grid-template-columns: 1fr;
  }
  .rail,
  .side,
  .terminal {
    display: none;
  }
}
</style>
