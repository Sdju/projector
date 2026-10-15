<script setup lang="ts">
import UiPopupSurface from "../common/ui/UiPopupSurface.vue";
import UiActionRow from "../common/ui/UiActionRow.vue";
import UiControl, { type UiControlHandle } from "../common/ui/UiControl.vue";
import UiInline from "../common/ui/UiInline.vue";
import UiStatusDot from "../common/ui/UiStatusDot.vue";
import { computed, nextTick, onMounted, onUnmounted, shallowRef, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  isLauncherWindow,
  LaunchDetailPanel,
  launcherStatusTone,
} from "../modules/launcher/index.ts";
import {
  createLauncherClient,
  launchScopeTitles,
  launchSectionTitles,
  parseLaunchQuery,
  resolveLauncherAction,
} from "../../core/modules/launcher/index.ts";
import type { LaunchAction } from "../../core/modules/launcher/index.ts";
import { createLauncherModel } from "../../core/modules/launcher/index.ts";

const router = useRouter();
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
const inputControl = ref<UiControlHandle>();
const input = computed(() => inputControl.value?.element as HTMLInputElement | undefined);
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
const focus = computed(() => state.value.focus);
const detailActions = computed(() => state.value.detail?.actions ?? []);
const failure = computed(() => state.value.detail?.failure);
const info = computed(() => state.value.detail?.info);
const detailIndex = ref(0);
const scope = computed(() => parseLaunchQuery(state.value.query).scope);
watch(focus, () => (detailIndex.value = 0));
async function enter() {
  if (await model.enter()) await nextTick();
}
async function launch(item = items.value[selected.value], action?: LaunchAction) {
  const chosen = action ?? item?.actions?.[0];
  if (!item || !chosen) return;
  const ok = await model.launch(item, chosen, !webWindow);
  if (chosen.id === "favorite" || chosen.id === "folder") {
    // Pinning keeps the palette and the open card in place; only the lists change.
    if (ok) await model.refresh();
    await nextTick();
    input.value?.focus();
    return;
  }
  if (ok) model.leave();
  if (ok && !webWindow && state.value.route) {
    await router.push(state.value.route);
    return;
  }
  if (ok && webWindow) {
    try {
      await hide();
    } catch (error) {
      model.reportError(error);
    }
  }
  await nextTick();
  input.value?.focus();
}
let pinPending = false;
async function toggleFavorite(item = focus.value ?? items.value[selected.value]) {
  if (!item || pinPending || state.value.busy || state.value.loading) return;
  pinPending = true;
  try {
    const action = await resolveLauncherAction(
      client,
      item,
      "favorite",
      focus.value?.id === item.id && state.value.detailReady ? state.value.detail : null,
    );
    if (action) await launch(item, action);
  } catch (error) {
    model.reportError(error);
  } finally {
    pinPending = false;
  }
}

function key(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
    event.preventDefault();
    toggleFavorite();
    return;
  }
  if (focus.value) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const count = detailActions.value.length;
      if (count)
        detailIndex.value =
          (detailIndex.value + (event.key === "ArrowDown" ? 1 : -1) + count) % count;
    } else if (event.key === "Enter") {
      event.preventDefault();
      void launch(focus.value, detailActions.value[detailIndex.value]);
    } else if (["Escape", "ArrowLeft", "Tab"].includes(event.key)) {
      event.preventDefault();
      model.leave();
    }
    return;
  }
  const atEnd = input.value?.selectionStart === input.value?.value.length;
  if (
    event.key === "Tab" ||
    (event.key === "ArrowRight" && atEnd && !event.shiftKey) ||
    (event.key === "k" && (event.ctrlKey || event.metaKey))
  ) {
    if (!items.value.length) return;
    event.preventDefault();
    void enter();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    model.move(event.key === "ArrowDown" ? 1 : -1);
    void nextTick(() =>
      document
        .getElementById(`launch-option-${selected.value}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  } else if (event.key === "Enter") {
    event.preventDefault();
    const item = items.value[selected.value];
    void launch(item, item?.actions?.[event.ctrlKey || event.metaKey ? 1 : 0]);
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
  model.live(true);
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
    </div>
    <UiPopupSurface
      as="section"
      border="line"
      radius="lg"
      class="palette"
      aria-label="Запуск приложений"
    >
      <UiInline class="search-line" :gap="4" justify="normal">
        <svg width="23" height="23" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.5" />
          <path d="m16 16 5 5" stroke="currentColor" stroke-width="1.5" />
        </svg>
        <span v-if="scope !== 'all'" class="scope-chip">{{ launchScopeTitles[scope] }}</span>
        <UiControl
          ref="inputControl"
          v-model="query"
          role="combobox"
          aria-label="Поиск приложений и проектов"
          aria-autocomplete="list"
          aria-controls="launch-results"
          :aria-expanded="items.length > 0"
          :aria-activedescendant="activeId"
          autocomplete="off"
          spellcheck="false"
          placeholder="Поиск приложений и проектов… (/ проекты, gh/ GitHub)"
          :disabled="busy"
          @keydown="key"
        />
        <span v-if="loading || busy" class="activity" aria-hidden="true">⋯</span>
      </UiInline>
      <div
        v-show="!focus"
        id="launch-results"
        class="results"
        role="listbox"
        aria-label="Результаты"
        :aria-busy="loading"
      >
        <template v-for="(item, index) in items" :key="item.id">
          <div
            v-if="item.section && item.section !== items[index - 1]?.section"
            class="section-title"
            role="presentation"
          >
            {{ launchSectionTitles[item.section] }}
          </div>
          <UiActionRow
            interaction="selection"
            padding="var(--sp-3)"
            :id="`launch-option-${index}`"
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
              ><span class="name"
                ><span v-if="item.favorite" class="star" title="В избранном" aria-hidden="true"
                  >★</span
                ><UiStatusDot
                  v-if="item.status"
                  class="status-dot"
                  :size="8"
                  inline
                  shrink
                  :tone="launcherStatusTone(item.status.state)"
                  :title="item.status.label"
                  aria-hidden="true"
                />{{ item.name }}</span
              ><span class="description u-truncate">{{ item.description }}</span></span
            >
            <span v-if="index === selected" class="enter" aria-hidden="true"
              >↵ {{ item.actions?.[0]?.title
              }}<template v-if="item.actions?.[1]">
                · Ctrl+↵ {{ item.actions[1].title }}</template
              ></span
            >
          </UiActionRow>
        </template>
      </div>
      <LaunchDetailPanel
        v-if="focus"
        v-model:index="detailIndex"
        :item="focus"
        :actions="detailActions"
        :info="info"
        :failure="failure"
        :loading="state.detailLoading"
        @launch="(action) => launch(focus!, action)"
      />
      <p v-if="!loading && !items.length && !error" class="empty">Ничего не найдено</p>
      <p v-if="error || warning || notice" class="message" :class="{ error }" role="status">
        {{ error || warning || notice }}
      </p>
      <UiInline as="footer" class="palette-footer" align="normal" justify="between" :gap="3" wrap>
        <span v-if="focus"
          >↑↓ выбрать <span class="separator">·</span> Enter выполнить
          <span class="separator">·</span> ← назад</span
        >
        <span v-else
          >↑↓ выбрать <span class="separator">·</span> Enter основное
          <span class="separator">·</span> Ctrl+Enter второе <span class="separator">·</span> →
          действия <span class="separator">·</span> Ctrl+D ★ <span class="separator">·</span> Esc
          {{ webWindow ? "закрыть" : "очистить" }}</span
        >
      </UiInline>
    </UiPopupSurface>
  </main>
</template>

<style scoped>
.launcher {
  width: min(640px, calc(100% - 32px));
  margin: min(18vh, 160px) auto 40px;
}
.launcher.in-window {
  margin-top: var(--sp-4);
}
.in-window {
  margin-bottom: var(--sp-4);
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
  font-size: var(--fs-sm);
  margin: 0 var(--sp-1) var(--sp-3);
}
.palette {
  overflow: hidden;
}
.search-line {
  padding: var(--sp-4) var(--sp-4);
  border-bottom: 1px solid var(--line);
  color: var(--muted);
}
.search-line input {
  padding: 0;
  border: 0;
  font-size: var(--fs-lg);
  color: var(--text);
  letter-spacing: normal;
  min-width: 0;
}
.search-line input::placeholder {
  color: var(--muted);
}
.activity {
  font-size: var(--fs-lg);
}
.results {
  padding: var(--sp-2);
  max-height: 440px;
  overflow-y: auto;
}
.results:empty {
  padding: 0;
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
  gap: var(--sp-1);
  min-width: 0;
  flex: 1;
}
.name {
  font-size: var(--fs-md);
}
.description {
  color: var(--muted);
  font-size: var(--fs-xs);
}
.enter {
  color: var(--muted);
  white-space: nowrap;
}
.section-title {
  padding: var(--sp-3) var(--sp-3) var(--sp-1);
  color: var(--muted);
  font-size: var(--fs-2xs);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.star {
  margin-right: var(--sp-2);
  color: var(--warn, var(--run));
}
.status-dot {
  margin-right: var(--sp-2);
}
.scope-chip {
  flex-shrink: 0;
  padding: 2px var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  color: var(--text);
  font-size: var(--fs-xs);
}
.empty,
.message {
  margin: 0;
  padding: var(--sp-4) var(--sp-4);
  color: var(--muted);
  font-size: var(--fs-sm);
}
.error {
  color: var(--err);
}
.palette-footer {
  padding: var(--sp-3) var(--sp-4);
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: var(--fs-2xs);
}
.separator {
  color: var(--faint);
  margin: 0 var(--sp-1);
}
a:hover {
  color: var(--text);
}
@media (max-width: 500px) {
  .search-line input {
    font-size: var(--fs-md);
  }
  .search-line {
    padding: var(--sp-4);
  }
}
</style>
