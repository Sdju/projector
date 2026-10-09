<script setup lang="ts">
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import { os } from "../../../core/modules/os/index.ts";
import {
  computed,
  shallowRef,
  ref,
  nextTick,
  watch,
  onUnmounted,
  markRaw,
  VWindow,
  VBox,
  VEntry,
  VListBox,
  VListBoxRow,
  VScrolledWindow,
  VLabel,
  VButton,
  VImage,
  VKeyController,
  type WidgetHandle,
  type WindowWidget,
  type EntryWidget,
  type ListBoxWidget,
  type ScrolledWidget,
  type RowWidget,
} from "vio";
import {
  createLauncherClient,
  createLauncherModel,
  launchScopeTitles,
  launchSectionTitles,
  parseLaunchQuery,
  type LaunchAction,
  type LaunchItem,
} from "../../../core/modules/launcher/index.ts";

const props = defineProps<{ baseUrl: string; applicationIcon: (id: string) => object | null }>();
GLib.setPrgname("projector-launcher");
GLib.setApplicationName("Projector");
const client = createLauncherClient(props.baseUrl);
const model = createLauncherModel(client);
const state = shallowRef({ ...model.state });
const unsubscribe = model.subscribe((value) => {
  state.value = value;
});
const query = computed({ get: () => state.value.query, set: (value) => model.setQuery(value) });
const status = computed(() => {
  const value = state.value;
  if (value.error) return value.error;
  if (value.busy) return "Запускаю…";
  if (value.focus) return value.detailLoading ? "Загрузка…" : "";
  if (value.loading) return "Поиск…";
  return value.warning || (value.items.length ? "" : "Ничего не найдено");
});
const focus = computed(() => state.value.focus);
const detailActions = computed(() => state.value.detail?.actions ?? []);
const failure = computed(() => state.value.detail?.failure);
const detailIndex = ref(0);
const scope = computed(() => parseLaunchQuery(state.value.query).scope);
const scopeTitle = computed(() => (scope.value === "all" ? "" : launchScopeTitles[scope.value]));
const infoText = computed(() => {
  const value = state.value.detail?.info;
  if (!value) return "";
  const marks = { idle: "○", starting: "●", running: "●", stopping: "◐", error: "✖" } as const;
  const parts = [value.stateLabel, value.command, value.url].filter(Boolean);
  return [value.path, `${marks[value.state]} ${parts.join(" · ")}`, value.docker]
    .filter(Boolean)
    .join("\n");
});
const failureText = computed(() => {
  const value = failure.value;
  if (!value) return "";
  const code = value.exitCode === null ? "" : ` (код ${value.exitCode})`;
  return `«${value.command}» завершилась с ошибкой${code}\n\n${value.output || "Вывод терминала пуст."}`;
});
const windowRef = ref<WidgetHandle<WindowWidget>>();
const entryRef = ref<WidgetHandle<EntryWidget>>();
const listRef = ref<WidgetHandle<ListBoxWidget>>();
const listScrollRef = ref<WidgetHandle<ScrolledWidget>>();
const detailScrollRef = ref<WidgetHandle<ScrolledWidget>>();
const detailListRef = ref<WidgetHandle<ListBoxWidget>>();
/** A list box does not scroll its selection by itself; keep the row inside the viewport. */
function scrollToRow(scroller?: ScrolledWidget | null, row?: RowWidget | null) {
  // Bounds must be taken in content coordinates: the widget inside the auto-added viewport.
  const viewport = scroller?.getChild();
  const target = viewport?.getChild?.() ?? viewport;
  if (!scroller || !target || !row) return;
  const [ok, rect] = row.computeBounds(target);
  if (!ok) return;
  const adjustment = scroller.getVadjustment();
  const top = rect.getY();
  const bottom = top + rect.getHeight();
  const value = adjustment.getValue();
  const page = adjustment.getPageSize();
  if (top < value) adjustment.setValue(top);
  else if (bottom > value + page) adjustment.setValue(bottom - page);
}
watch(
  () => [state.value.selected, state.value.items],
  async () => {
    await nextTick();
    scrollToRow(
      listScrollRef.value?.widget,
      listRef.value?.widget?.getRowAtIndex(state.value.selected),
    );
  },
);
watch(detailIndex, async () => {
  await nextTick();
  scrollToRow(
    detailScrollRef.value?.widget,
    detailListRef.value?.widget?.getRowAtIndex(detailIndex.value),
  );
});
const icons = new Map<string, object | null>();
let wasActive = false;
let blurTimer: ReturnType<typeof setTimeout> | undefined;
let opening = false;

function appIcon(item: LaunchItem) {
  if (item.kind !== "application") return null;
  if (!icons.has(item.id)) {
    try {
      const icon = props.applicationIcon(item.id.slice(4));
      icons.set(item.id, icon ? markRaw(icon) : null);
    } catch {
      icons.set(item.id, null);
    }
  }
  return icons.get(item.id);
}
function itemTitle(item: LaunchItem) {
  const marks = { running: "●", starting: "●", stopping: "◐", error: "✖" } as const;
  const name = item.status ? `${marks[item.status.state]} ${item.name}` : item.name;
  return item.favorite ? `★ ${name}` : name;
}
function sectionTitle(item: LaunchItem, index: number) {
  return item.section && item.section !== state.value.items[index - 1]?.section
    ? launchSectionTitles[item.section]
    : "";
}
function rowHint(item: LaunchItem) {
  const [first, second] = item.actions ?? [];
  return second
    ? `${item.description} · Enter: ${first.title} · Ctrl+Enter: ${second.title}`
    : item.description;
}
async function show() {
  if (process.env.PROJECTOR_DEBUG_PALETTE) console.error(`palette show\n${new Error().stack}`);
  clearTimeout(blurTimer);
  model.live(true);
  model.setQuery("");
  await nextTick();
  const window = windowRef.value!.widget!;
  wasActive = window.isActive();
  window.present();
  entryRef.value?.widget?.grabFocus();
  void model.search();
  void focusWindow();
}
function hide() {
  if (process.env.PROJECTOR_DEBUG_PALETTE) console.error(`palette hide\n${new Error().stack}`);
  clearTimeout(blurTimer);
  model.live(false);
  windowRef.value?.widget?.hide();
  return true;
}
async function toggle() {
  if (windowRef.value?.widget?.getVisible()) hide();
  else await show();
}
function activeChanged() {
  clearTimeout(blurTimer);
  const window = windowRef.value?.widget;
  if (window?.isActive()) wasActive = true;
  else if (wasActive && window?.getVisible())
    blurTimer = setTimeout(() => {
      if (window.getVisible() && !window.isActive()) hide();
    }, 100);
}
async function focusWindow() {
  const surface = windowRef.value?.widget?.getSurface();
  if (surface) await os.windows.activateSurface(surface);
}
async function launch(index = state.value.selected, secondary = false) {
  const item = state.value.items[index];
  const action = item?.actions?.[secondary ? 1 : 0];
  if (!action) return;
  if (await model.launch(item, action)) hide();
  else focusEntryAtEnd();
}
/** `grabFocus` selects the whole text; put the caret back at the end so typing continues. */
function focusEntryAtEnd() {
  const entry = entryRef.value?.widget;
  if (!entry) return;
  entry.grabFocus();
  entry.setPosition(-1);
}
async function pin(item: LaunchItem | undefined) {
  if (!item || item.kind === "github") return;
  // Pinning keeps the palette and the open card in place; only the lists change.
  const ok = await model.launch(item, { id: "favorite", title: "" });
  if (ok) await model.refresh();
  // The entry is insensitive while the action runs and loses its caret.
  await nextTick();
  focusEntryAtEnd();
}
async function launchDetail() {
  const item = state.value.focus;
  const action: LaunchAction | undefined = detailActions.value[detailIndex.value];
  if (!item || !action) return;
  if (action.id === "favorite") {
    await pin(item);
    return;
  }
  if (await model.launch(item, action)) {
    model.leave();
    hide();
  } else focusEntryAtEnd();
}
async function enter() {
  if (!state.value.items.length) return;
  detailIndex.value = 0;
  await model.enter();
}
function entryHasFocus() {
  const entry = entryRef.value?.widget;
  const current = windowRef.value?.widget?.getFocus();
  return !!entry && (current === entry || !!current?.isAncestor(entry));
}
function caretAtEnd() {
  const entry = entryRef.value?.widget;
  return !!entry && entry.getPosition() >= entry.getText().length;
}
async function invokeSelected(toggle = false) {
  if (opening) return;
  opening = true;
  try {
    await client.open(toggle);
  } catch (error) {
    await show();
    model.reportError(error);
  } finally {
    opening = false;
  }
}
function openPage(path: string) {
  os.windows.openBrowser(props.baseUrl + path);
}
async function quitProjector() {
  try {
    await client.quit();
  } catch (error) {
    await show();
    model.reportError(error);
  }
}
async function restartProjector() {
  if (opening) return;
  opening = true;
  try {
    await client.restart();
  } catch (error) {
    await show();
    model.reportError(error);
  } finally {
    opening = false;
  }
}
function keyPressed(keyval: number, _keycode?: number, modifiers = 0) {
  const ctrl = (modifiers & Gdk.ModifierType.CONTROL_MASK) !== 0;
  if (ctrl && (keyval === Gdk.KEY_d || keyval === Gdk.KEY_D)) {
    void pin(focus.value ?? state.value.items[state.value.selected]);
    return true;
  }
  if (focus.value) {
    if (keyval === Gdk.KEY_Escape || keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Tab) {
      model.leave();
      return true;
    }
    if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_Up) {
      const count = detailActions.value.length;
      if (count)
        detailIndex.value =
          (detailIndex.value + (keyval === Gdk.KEY_Down ? 1 : -1) + count) % count;
      return true;
    }
    if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
      void launchDetail();
      return true;
    }
    return false;
  }
  if (keyval === Gdk.KEY_Escape) return hide();
  if (
    keyval === Gdk.KEY_Tab ||
    (keyval === Gdk.KEY_Right && entryHasFocus() && caretAtEnd()) ||
    (ctrl && (keyval === Gdk.KEY_k || keyval === Gdk.KEY_K))
  ) {
    void enter();
    return true;
  }
  if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_Up) {
    model.move(keyval === Gdk.KEY_Down ? 1 : -1);
    return true;
  }
  if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
    const current = windowRef.value?.widget?.getFocus();
    const list = listRef.value?.widget;
    if (entryHasFocus() || (list && (current === list || current?.isAncestor(list)))) {
      void launch(undefined, ctrl);
      return true;
    }
  }
  return false;
}
function detailActivated(row: RowWidget) {
  detailIndex.value = row.getIndex();
  void launchDetail();
}
function rowActivated(row: RowWidget) {
  void launch(row.getIndex());
}
onUnmounted(() => {
  clearTimeout(blurTimer);
  unsubscribe();
  model.dispose();
  icons.clear();
});
defineExpose({ show, hide, toggle, invokeSelected, openPage, quitProjector, restartProjector });
</script>

<template>
  <VWindow
    ref="windowRef"
    title="Projector — поиск"
    :default-width="620"
    :default-height="380"
    :decorated="false"
    :resizable="false"
    @close-request="hide"
    @notify::is-active="activeChanged"
  >
    <VKeyController propagation-phase="capture" @key-pressed="keyPressed" />
    <VBox
      orientation="vertical"
      :spacing="8"
      :margin-top="16"
      :margin-bottom="12"
      :margin-start="16"
      :margin-end="16"
    >
      <VBox :spacing="8">
        <VLabel v-if="scopeTitle" class="scope-chip" :valign="3">{{ scopeTitle }}</VLabel>
        <VEntry
          ref="entryRef"
          v-model="query"
          id="projector-search"
          :hexpand="true"
          placeholder-text="Поиск приложений и проектов… (/ проекты, gh/ GitHub)"
          :sensitive="!state.busy"
          @activate="focus ? launchDetail() : launch()"
        />
      </VBox>
      <VScrolledWindow v-if="focus" ref="detailScrollRef" :vexpand="true">
        <VBox orientation="vertical" :spacing="8">
          <VLabel :xalign="0" class="heading">← {{ focus.name }}</VLabel>
          <VLabel v-if="infoText" :xalign="0" :wrap="true" class="dim-label info-text">{{
            infoText
          }}</VLabel>
          <VListBox
            ref="detailListRef"
            selection-mode="single"
            :activate-on-single-click="true"
            :selected="detailIndex"
            :sensitive="!state.busy"
            @row-activated="detailActivated"
          >
            <VListBoxRow v-for="action in detailActions" :key="`${action.id}:${action.arg ?? ''}`">
              <VLabel :xalign="0">{{ action.title }}</VLabel>
            </VListBoxRow>
          </VListBox>
          <VLabel
            v-if="failureText"
            :xalign="0"
            :wrap="true"
            :selectable="true"
            class="monospace failure-text"
            >{{ failureText }}</VLabel
          >
        </VBox>
      </VScrolledWindow>
      <VScrolledWindow v-else ref="listScrollRef" :vexpand="true">
        <VListBox
          ref="listRef"
          selection-mode="single"
          :activate-on-single-click="true"
          :selected="state.selected"
          :sensitive="!state.busy && !state.loading"
          @row-activated="rowActivated"
        >
          <VListBoxRow v-for="(item, index) in state.items" :key="item.id">
            <VBox orientation="vertical" :spacing="4">
              <VLabel
                v-if="sectionTitle(item, index)"
                :xalign="0"
                class="dim-label section-title"
                >{{ sectionTitle(item, index) }}</VLabel
              >
              <VBox :spacing="12">
                <VImage v-if="appIcon(item)" :gicon="appIcon(item)" :pixel-size="32" />
                <VImage
                  v-else
                  :icon-name="
                    item.kind === 'project'
                      ? 'folder'
                      : item.kind === 'github'
                        ? 'folder-remote'
                        : 'application-x-executable'
                  "
                  :pixel-size="32"
                />
                <VBox orientation="vertical" :spacing="2" :hexpand="true">
                  <VLabel :xalign="0">{{ itemTitle(item) }}</VLabel>
                  <VLabel :xalign="0" ellipsize="end" :max-width-chars="56" class="dim-label">{{
                    rowHint(item)
                  }}</VLabel>
                </VBox>
              </VBox>
            </VBox>
          </VListBoxRow>
        </VListBox>
      </VScrolledWindow>
      <VLabel :xalign="0" :wrap="true" class="dim-label">{{ status }}</VLabel>
      <VBox :spacing="12">
        <VLabel :xalign="0" :hexpand="true" class="dim-label">{{
          focus
            ? "↑↓ выбрать Enter выполнить ← назад"
            : "↑↓ выбрать Enter основное Ctrl+Enter второе → все действия Ctrl+D избранное Esc закрыть"
        }}</VLabel>
        <VButton
          class="flat"
          @clicked="
            openPage('/settings');
            hide();
          "
          >Настройки</VButton
        >
      </VBox>
    </VBox>
  </VWindow>
</template>

<style>
#projector-search {
  font-size: 20px;
  min-height: 44px;
}
list row {
  border-radius: 6px;
  padding: 10px;
}
list {
  background: transparent;
}
.scope-chip {
  padding: 0 10px;
  border-radius: 6px;
  background-color: alpha(currentColor, 0.12);
}
.section-title {
  font-size: 11px;
  font-weight: bold;
}
.info-text {
  font-size: 12px;
}
.failure-text {
  padding: 10px;
  border-radius: 6px;
  background-color: alpha(currentColor, 0.08);
  font-size: 12px;
}
</style>
