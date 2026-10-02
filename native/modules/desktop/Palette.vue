<script setup lang="ts">
import Gdk from "gi:Gdk-4.0";
import GLib from "gi:GLib-2.0";
import Gio from "gi:Gio-2.0";
import { spawn } from "node:child_process";
import {
  computed,
  shallowRef,
  ref,
  nextTick,
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
  type RowWidget,
} from "vio";
import { createLauncherClient, type LaunchItem } from "../../../core/modules/launcher/index.ts";
import { createLauncherModel } from "../../../core/modules/launcher/index.ts";
import { desktopApp } from "./catalog.ts";

const props = defineProps<{ baseUrl: string }>();
GLib.setPrgname("projector-launcher");
GLib.setApplicationName("Projector");
const client = createLauncherClient(props.baseUrl);
const model = createLauncherModel(client);
const state = shallowRef({ ...model.state });
const unsubscribe = model.subscribe((value) => {
  state.value = value;
});
const query = computed({ get: () => state.value.query, set: (value) => model.setQuery(value) });
const status = computed(
  () =>
    state.value.error ||
    (state.value.busy
      ? "Запускаю…"
      : state.value.loading
        ? "Поиск…"
        : state.value.warning || (state.value.items.length ? "" : "Ничего не найдено")),
);
const windowRef = ref<WidgetHandle<WindowWidget>>();
const entryRef = ref<WidgetHandle<EntryWidget>>();
const listRef = ref<WidgetHandle<ListBoxWidget>>();
const icons = new Map<string, object | null>();
let wasActive = false;
let blurTimer: ReturnType<typeof setTimeout> | undefined;
let opening = false;

function appIcon(item: LaunchItem) {
  if (item.kind !== "application") return null;
  if (!icons.has(item.id)) {
    try {
      const icon = desktopApp(item.id.slice(4)).getIcon();
      icons.set(item.id, icon ? markRaw(icon) : null);
    } catch {
      icons.set(item.id, null);
    }
  }
  return icons.get(item.id);
}
async function show() {
  clearTimeout(blurTimer);
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
  clearTimeout(blurTimer);
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
  if (!surface) return;
  try {
    const { default: GdkX11 } = await import("gi:GdkX11-4.0");
    if (surface instanceof GdkX11.X11Surface) {
      const child = spawn("xdotool", ["windowactivate", "--sync", String(surface.getXid())], {
        stdio: "ignore",
      });
      child.on("error", () => {});
    }
  } catch {
    /* Wayland uses compositor activation. */
  }
}
async function launch(index = state.value.selected) {
  if (await model.launch(state.value.items[index])) hide();
  else entryRef.value?.widget?.grabFocus();
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
  Gio.AppInfo.launchDefaultForUri(props.baseUrl + path, null);
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
function keyPressed(keyval: number) {
  if (keyval === Gdk.KEY_Escape) return hide();
  if (keyval === Gdk.KEY_Down || keyval === Gdk.KEY_Up) {
    model.move(keyval === Gdk.KEY_Down ? 1 : -1);
    void nextTick(() => {
      listRef.value?.widget?.getRowAtIndex(state.value.selected)?.grabFocus();
      entryRef.value?.widget?.grabFocus();
    });
    return true;
  }
  if (keyval === Gdk.KEY_Return || keyval === Gdk.KEY_KP_Enter) {
    const focus = windowRef.value?.widget?.getFocus();
    const entry = entryRef.value?.widget;
    const list = listRef.value?.widget;
    if (
      (entry && (focus === entry || focus?.isAncestor(entry))) ||
      (list && (focus === list || focus?.isAncestor(list)))
    ) {
      void launch();
      return true;
    }
  }
  return false;
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
      <VEntry
        ref="entryRef"
        v-model="query"
        id="projector-search"
        placeholder-text="Поиск приложений и проектов…"
        :sensitive="!state.busy"
        @activate="launch()"
      />
      <VScrolledWindow :vexpand="true">
        <VListBox
          ref="listRef"
          selection-mode="single"
          :activate-on-single-click="true"
          :selected="state.selected"
          :sensitive="!state.busy && !state.loading"
          @row-activated="rowActivated"
        >
          <VListBoxRow v-for="item in state.items" :key="item.id">
            <VBox :spacing="12">
              <VImage v-if="appIcon(item)" :gicon="appIcon(item)" :pixel-size="32" />
              <VImage
                v-else
                :icon-name="item.kind === 'project' ? 'folder' : 'application-x-executable'"
                :pixel-size="32"
              />
              <VBox orientation="vertical" :spacing="2" :hexpand="true">
                <VLabel :xalign="0">{{ item.name }}</VLabel>
                <VLabel :xalign="0" ellipsize="end" :max-width-chars="56" class="dim-label">{{
                  item.description
                }}</VLabel>
              </VBox>
            </VBox>
          </VListBoxRow>
        </VListBox>
      </VScrolledWindow>
      <VLabel :xalign="0" :wrap="true" class="dim-label">{{ status }}</VLabel>
      <VBox :spacing="12">
        <VLabel :xalign="0" :hexpand="true" class="dim-label"
          >↑↓ выбрать Enter запустить Esc закрыть</VLabel
        >
        <VButton
          class="flat"
          @clicked="
            openPage('/projects');
            hide();
          "
          >Проекты и настройки</VButton
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
</style>
