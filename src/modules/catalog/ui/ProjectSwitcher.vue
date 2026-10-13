<script setup lang="ts">
import UiActionCopy from "../../../common/ui/UiActionCopy.vue";
import UiBadge from "../../../common/ui/UiBadge.vue";
import UiControl, { type UiControlHandle } from "../../../common/ui/UiControl.vue";
import UiInline from "../../../common/ui/UiInline.vue";
import UiPopupSurface from "../../../common/ui/UiPopupSurface.vue";
import UiIslandLabel from "../../../common/ui/UiIslandLabel.vue";
import UiIslandFooter from "../../../common/ui/UiIslandFooter.vue";
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { onClickOutside } from "@vueuse/core";
import { useRouter } from "vue-router";
import { useCommandScope } from "../../../common/utilities/commands.ts";
import {
  createLauncherClient,
  createLauncherModel,
  launchSectionTitles,
  type LaunchItem,
} from "../../../../core/modules/launcher/index.ts";
import { projectIconUrl, type ProjectLocation } from "../../project/index.ts";
import PathBar from "./PathBar.vue";
import IconChevron from "~icons/lucide/chevron-down";
import IconSearch from "~icons/lucide/search";

/**
 * Переключатель проекта: кнопка с текущим проектом открывает остров с путём к папке
 * (родители и соседние папки), поиском проектов и списком недавних.
 */
const props = defineProps<{
  project: ProjectLocation;
  navigate: (path: string) => Promise<void>;
}>();
const router = useRouter();
const root = ref<HTMLElement>();
const input = ref<UiControlHandle>();
const open = ref(false);
const text = ref("");
const listId = useId();
const state = shallowRef<ReturnType<typeof createLauncherModel>["state"]>();
let model: ReturnType<typeof createLauncherModel> | undefined;
let unsubscribe: (() => void) | undefined;

const commands = useCommandScope("project-switcher", () => ({
  surface: "project-switcher",
  project: props.project.path,
}));
commands.scope.registerCommand({
  id: "ide.project.switcher.toggle",
  title: "Открыть или закрыть переключатель проектов",
  description:
    "Показывает остров с путём текущего проекта, поиском других проектов и списком недавних.",
  run: () => toggle(),
});

/** Поиск в переключателе — по проектам; ссылки и gh/, gl/ остаются как есть. */
const toQuery = (value: string) =>
  /^(gh|gl)\//i.test(value) || /^https?:/i.test(value) ? value : `/${value}`;
watch(text, (value) => model?.setQuery(toQuery(value.trim())));

const currentId = computed(() => `project:${props.project.id}`);
const items = computed(() =>
  (state.value?.items ?? []).filter((item) => item.id !== currentId.value),
);
const selected = computed(() => state.value?.selected ?? 0);
const rows = computed(() =>
  items.value.map((item, index) => ({
    item,
    index,
    heading:
      !text.value.trim() && item.section && item.section !== items.value[index - 1]?.section
        ? launchSectionTitles[item.section]
        : "",
  })),
);

function start() {
  model = createLauncherModel(createLauncherClient());
  state.value = { ...model.state };
  unsubscribe = model.subscribe((value) => (state.value = value));
  model.setQuery("/");
  model.live(true);
}
function stop() {
  unsubscribe?.();
  model?.dispose();
  model = undefined;
  unsubscribe = undefined;
  state.value = undefined;
}
async function toggle(force = !open.value) {
  if (force === open.value) return;
  open.value = force;
  if (force) {
    text.value = "";
    start();
    await nextTick();
    input.value?.focus();
  } else {
    stop();
    root.value?.querySelector<HTMLElement>(".trigger")?.focus();
  }
}
onClickOutside(root, () => open.value && void toggle(false));
onBeforeUnmount(stop);

async function pick(item: LaunchItem | undefined, secondary = false) {
  if (!model || !item) return;
  const ok = await model.launch(item, item.actions?.[secondary ? 1 : 0], true);
  if (!ok) return;
  const route = model.state.route;
  await toggle(false);
  if (route) await router.push(route);
}
async function go(path: string) {
  await props.navigate(path);
  await toggle(false);
}
function keydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    model?.move(event.key === "ArrowDown" ? 1 : -1);
    void nextTick(() =>
      document.getElementById(`${listId}-${selected.value}`)?.scrollIntoView({ block: "nearest" }),
    );
  } else if (event.key === "Enter") {
    event.preventDefault();
    void pick(items.value[selected.value], event.ctrlKey || event.metaKey);
  }
}
</script>

<template>
  <div ref="root" class="switcher" @keydown.esc.stop="toggle(false)">
    <button
      class="trigger"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :title="`${project.name} — переключить проект`"
      @click="commands.run('ide.project.switcher.toggle')"
    >
      <img :src="projectIconUrl(project)" alt="" width="22" height="22" />
      <span class="u-truncate">{{ project.name }}</span>
      <IconChevron aria-hidden="true" />
    </button>
    <UiPopupSurface
      as="section"
      flow="column"
      v-if="open"
      class="island"
      role="dialog"
      aria-label="Переключение проекта"
    >
      <PathBar class="island-path" :path="project.path" :navigate="go" />
      <UiInline as="label" class="search" justify="normal">
        <IconSearch aria-hidden="true" />
        <UiControl
          ref="input"
          v-model="text"
          role="combobox"
          aria-label="Найти проект"
          placeholder="Найти проект, gh/owner/repo…"
          :aria-expanded="true"
          :aria-controls="listId"
          :aria-activedescendant="items.length ? `${listId}-${selected}` : undefined"
          autocomplete="off"
          spellcheck="false"
          @keydown="keydown"
        />
      </UiInline>
      <div :id="listId" class="results" role="listbox">
        <template v-for="row in rows" :key="row.item.id">
          <UiIslandLabel v-if="row.heading">{{ row.heading }}</UiIslandLabel>
          <button
            :id="`${listId}-${row.index}`"
            class="row"
            :class="{ active: row.index === selected }"
            role="option"
            :aria-selected="row.index === selected"
            :disabled="state?.busy"
            @mousemove="model?.select(row.index)"
            @click="pick(row.item)"
          >
            <img v-if="row.item.icon" :src="row.item.icon" alt="" width="28" height="28" />
            <UiActionCopy
              :title="row.item.name"
              :description="row.item.description"
              truncate-title
            />
            <UiBadge v-if="row.item.status">{{ row.item.status.label }}</UiBadge>
          </button>
        </template>
        <p v-if="state && !state.loading && !items.length" class="empty">Ничего не найдено</p>
        <p v-if="state?.error" class="empty error" role="alert">{{ state.error }}</p>
      </div>
      <UiIslandFooter variant="plain">↑↓ выбрать · Enter открыть · Esc закрыть</UiIslandFooter>
    </UiPopupSurface>
  </div>
</template>

<style scoped>
.switcher {
  position: relative;
  min-width: 0;
}
.trigger {
  --trigger-h: 30px;
  position: relative;
  z-index: calc(var(--z-popover) + 1);
  display: flex;
  height: var(--trigger-h);
  align-items: center;
  gap: var(--sp-2);
  max-width: min(40vw, 360px);
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-md);
  color: var(--text);
  font-size: var(--fs-sm);
}
.trigger:hover {
  background: var(--hover);
}
/* Открытый остров охватывает и саму кнопку: она становится его заголовком */
.trigger[aria-expanded="true"] {
  background: none;
}
.trigger[aria-expanded="true"] svg {
  transform: rotate(180deg);
}
.trigger img {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: var(--r-sm);
}

.trigger svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--muted);
}
.island {
  position: absolute;
  top: calc(-1 * var(--sp-1));
  left: calc(-1 * var(--sp-2));
  z-index: var(--z-popover);
  gap: var(--sp-2);
  width: min(560px, calc(100vw - var(--sp-4)));
  box-sizing: border-box;
  padding: calc(var(--sp-1) + 30px) var(--sp-2) var(--sp-2);
}
.island-path {
  flex: none;
}
.search {
  padding-inline: var(--sp-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: var(--bg);
  color: var(--muted);
}
.search:focus-within {
  border-color: var(--focus);
}
.search svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
/* Видимый фокус показывает рамка обёртки */
.search input,
.search input:hover,
.search input:focus,
.search input:focus-visible {
  outline: none;
  border: 0;
  padding-inline: 0;
  font-size: var(--fs-sm);
  color: var(--text);
}
.results {
  display: flex;
  flex-direction: column;
  max-height: min(380px, 50dvh);
  overflow-y: auto;
}
.row {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  width: 100%;
  padding: var(--sp-1) var(--sp-2);
  border-radius: var(--r-md);
  text-align: left;
}
.row.active,
.row:hover:not(:disabled) {
  background: var(--active);
}
.row img {
  flex-shrink: 0;
  object-fit: contain;
  border-radius: var(--r-sm);
}
.empty {
  margin: 0;
  padding: var(--sp-3);
  color: var(--muted);
  font-size: var(--fs-xs);
  text-align: center;
}
.empty.error {
  color: var(--err);
}
</style>
