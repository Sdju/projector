<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, shallowRef, ref } from "vue";
import { isLauncherWindow } from "../modules/launcher/index.ts";
import { createLauncherClient } from "../../core/modules/launcher/index.ts";
import { createLauncherModel } from "../../core/modules/launcher/index.ts";

const client = createLauncherClient();
const model = createLauncherModel(client);
const state = shallowRef({ ...model.state });
const unsubscribe = model.subscribe((value) => {
  state.value = value;
});
const query = computed({ get: () => state.value.query, set: (value) => model.setQuery(value) });
const items = computed(() => state.value.items);
const selected = computed({ get: () => state.value.selected, set: (value) => model.select(value) });
const loading = computed(() => state.value.loading);
const busy = computed(() => state.value.busy);
const error = computed(() => state.value.error);
const warning = computed(() => state.value.warning);
const notice = computed(() => state.value.notice);
const input = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
const webWindow = isLauncherWindow;
const activeId = computed(() =>
  items.value.length ? `launch-option-${selected.value}` : undefined,
);

async function hide() {
  if (webWindow) await client.hide();
  else {
    model.setQuery("");
    input.value?.focus();
  }
}
async function launch(item = items.value[selected.value]) {
  if ((await model.launch(item)) && webWindow) {
    try {
      await hide();
    } catch (error) {
      model.reportError(error);
    }
  }
  await nextTick();
  input.value?.focus();
}
function key(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    model.move(event.key === "ArrowDown" ? 1 : -1);
    void nextTick(() => list.value?.children[selected.value]?.scrollIntoView({ block: "nearest" }));
  } else if (event.key === "Enter") {
    event.preventDefault();
    void launch();
  } else if (event.key === "Escape") {
    event.preventDefault();
    void hide().catch((error) => model.reportError(error));
  }
}
function focusSearch() {
  input.value?.focus();
  if (!busy.value) void model.search(items.value.length > 0 && !loading.value);
}
function showSearch() {
  if (!webWindow) return;
  model.setQuery("");
  focusSearch();
}
onMounted(() => {
  focusSearch();
  window.addEventListener("focus", focusSearch);
  window.addEventListener("projector:show", showSearch);
});
onUnmounted(() => {
  unsubscribe();
  model.dispose();
  window.removeEventListener("focus", focusSearch);
  window.removeEventListener("projector:show", showSearch);
});
</script>

<template>
  <main class="launcher" :class="{ 'in-window': webWindow }">
    <div class="launcher-heading">
      <router-link to="/">projector</router-link>
      <router-link to="/settings" aria-label="Настройки">Настройки</router-link>
    </div>
    <section class="palette" aria-label="Запуск приложений">
      <div class="search-line">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.5" />
          <path d="m16 16 5 5" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <input
          ref="input"
          v-model="query"
          role="combobox"
          aria-label="Поиск приложений и проектов"
          aria-autocomplete="list"
          aria-controls="launch-results"
          :aria-expanded="items.length > 0"
          :aria-activedescendant="activeId"
          autocomplete="off"
          spellcheck="false"
          placeholder="Поиск приложений и проектов…"
          :disabled="busy"
          @keydown="key"
        />
        <span v-if="loading || busy" class="activity" aria-hidden="true">⋯</span>
      </div>
      <div
        ref="list"
        id="launch-results"
        class="results"
        role="listbox"
        aria-label="Результаты"
        :aria-busy="loading"
      >
        <button
          v-for="(item, index) in items"
          :id="`launch-option-${index}`"
          :key="item.id"
          role="option"
          :aria-selected="index === selected"
          class="result"
          :class="{ selected: index === selected }"
          :disabled="busy || loading"
          tabindex="-1"
          @mousemove="selected = index"
          @click="launch(item)"
        >
          <img v-if="item.icon" :src="item.icon" alt="" width="36" height="36" />
          <span class="result-copy"
            ><span class="name">{{ item.name }}</span
            ><span class="description">{{ item.description }}</span></span
          >
          <span v-if="index === selected" class="enter" aria-hidden="true">↵</span>
        </button>
      </div>
      <p v-if="!loading && !items.length && !error" class="empty">Ничего не найдено</p>
      <p v-if="error || warning || notice" class="message" :class="{ error }" role="status">
        {{ error || warning || notice }}
      </p>
      <footer class="palette-footer">
        <span
          >↑↓ выбрать <span class="separator">·</span> Enter запустить
          <span class="separator">·</span> Esc {{ webWindow ? "закрыть" : "очистить" }}</span
        >
        <router-link to="/projects">Проекты →</router-link>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.launcher {
  width: min(640px, calc(100% - 32px));
  margin: min(18vh, 160px) auto 40px;
}
.launcher.in-window {
  margin-top: 18px;
}
.in-window {
  margin-bottom: 18px;
}
.in-window .palette {
  max-height: calc(100dvh - 70px);
  display: flex;
  flex-direction: column;
}
.in-window .results {
  min-height: 0;
  flex-shrink: 1;
}
.in-window .search-line,
.in-window .palette-footer,
.in-window .message {
  flex-shrink: 0;
}
.launcher-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--muted);
  font-size: 13px;
  margin: 0 4px 12px;
}
.palette {
  background: var(--bg-2);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 16px 60px #0003;
  overflow: hidden;
}
.search-line {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}
.search-line input {
  padding: 0;
  border: 0;
  font-size: 20px;
  color: var(--text);
  letter-spacing: normal;
  min-width: 0;
}
.search-line input::placeholder {
  color: var(--muted);
}
.activity {
  font-size: 24px;
}
.results {
  padding: 8px;
  max-height: 440px;
  overflow-y: auto;
}
.results:empty {
  padding: 0;
}
.result {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 11px 12px;
  text-align: left;
  border-radius: 6px;
}
.result.selected {
  background: #ffffff0c;
}
.result:disabled {
  cursor: wait;
  opacity: 0.65;
}
.result img {
  object-fit: contain;
  flex-shrink: 0;
}
.result-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.name {
  font-size: 15px;
}
.description {
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.enter {
  color: var(--muted);
}
.empty,
.message {
  margin: 0;
  padding: 18px 20px;
  color: var(--muted);
  font-size: 13px;
}
.error {
  color: var(--err);
}
.palette-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.separator {
  color: var(--faint);
  margin: 0 4px;
}
a:hover {
  color: var(--text);
}
@media (max-width: 500px) {
  .search-line input {
    font-size: 16px;
  }
  .search-line {
    padding: 16px;
  }
}
</style>
