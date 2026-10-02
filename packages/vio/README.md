# vio

Vue custom renderer для GTK4 на Node.js. Компоненты, реактивность, `v-for`, `v-if`, slots и lifecycle выполняет Vue; дерево виджетов и сигналы обслуживает GTK. DOM, WebView и Chromium для нативного интерфейса не используются.

## Быстрый старт

Нужны Node.js 24+, GTK4 и GObject Introspection. Установите `vio` и его peer dependency `node-gtk`. В этом workspace зависимости устанавливаются командой `vp install`.

```vue
<!-- Counter.vue -->
<script setup lang="ts">
import { ref, VWindow, VBox, VEntry, VLabel, VButton } from 'vio'
const name = ref('Vue + GTK')
const count = ref(0)
defineProps<{ quit: () => void }>()
</script>

<template>
  <VWindow title="vio" :visible="true" @close-request="quit">
    <VBox orientation="vertical" :spacing="12" :margin-top="24">
      <VEntry v-model="name" />
      <VLabel>{{ name }} · {{ count }}</VLabel>
      <VButton @clicked="count++">Увеличить</VButton>
    </VBox>
  </VWindow>
</template>

<style scoped>
label { font-size: 22px; }
</style>
```

```ts
// main.ts
import Gtk from 'gi:Gtk-4.0'
import GLib from 'gi:GLib-2.0'
import { createApp } from 'vio'
import Counter from './Counter.vue'

Gtk.init()
const loop = GLib.MainLoop.new(null, false)
const app = createApp(Counter, {
  quit: () => { app.unmount(); loop.quit(); return true },
})
app.mount()
loop.run()
```

```bash
node --import vio/register main.ts
```

`vio/register` регистрирует и `.vue`, и `gi:` imports. SFC компилируется один раз при импорте, с inline render function для `@vue/runtime-core`. Для TS используется встроенное удаление типов Node; в Node 24 вызов этого API может печатать ExperimentalWarning. Runtime-only приложения могут использовать `h()` и загрузчик `node-gtk/register` без SFC-компилятора.

## Компоненты и свойства

| Компонент | GTK |
| --- | --- |
| `VWindow`, `VBox`, `VGrid`, `VStack` | Window, Box, Grid, Stack |
| `VEntry`, `VLabel`, `VButton`, `VImage` | Entry, Label, Button, Image |
| `VListBox`, `VListBoxRow`, `VScrolledWindow` | ListBox, ListBoxRow, ScrolledWindow |
| `VSeparator`, `VSpinner`, `VSwitch`, `VCheckButton` | Separator, Spinner, Switch, CheckButton |
| `VKeyController` | EventControllerKey |

Атрибуты соответствуют GObject properties. Принимаются camelCase и kebab-case: `:margin-top="16"`, `:hexpand="true"`, `:sensitive="!busy"`. Числа и boolean передавайте через `:`. `id` устанавливает GTK widget name. `class` поддерживает строку, массив и объект Vue; удаление binding восстанавливает исходные свойства и классы GTK.

Enum props можно передавать строками: `orientation="vertical"`, `selection-mode="single"`, `ellipsize="end"`, `propagation-phase="capture"`, `halign="center"`. Для других enum/flags передавайте значение импортированного GI namespace.

`VListBox` принимает `selected` — индекс строки; `-1` снимает выбор. Его непосредственные виджеты должны быть `VListBoxRow`. У Window, Button, Row и ScrolledWindow один widget child: несколько соседних виджетов оборачиваются в `VBox`. Event controller не занимает это место. Для детей `VGrid` доступны `row`, `column`, `row-span`, `column-span`; страницы `VStack` именуются через `name`.

Также доступны raw элементы `<gtk-box>`, `<gtk-label>` и другие зарегистрированные `gtk-*` tags. Они используют тот же renderer.

## Сигналы, модель и refs

`@clicked`, `@changed`, `@row-activated`, `@close-request`, `@notify::is-active` соответствуют GTK signals. В обработчик передаются аргументы сигнала; callback может вернуть `true`, чтобы поглотить GTK-событие. `.once` поддерживается. Renderer обновляет callback без повторного подключения и отключает сигналы при unmount; ошибки передаются в Vue `app.config.errorHandler`.

`VEntry` поддерживает `v-model` через `text` / `changed`. Программное обновление свойства не вызывает обратный model-update. Для Switch и CheckButton используйте `:active` с `@notify::active` / `@toggled`.

Ref компонента открывает `.element` — host node и `.widget` — реальный GTK объект:

```ts
import { ref, type WidgetHandle, type EntryWidget } from 'vio'
const search = ref<WidgetHandle<EntryWidget>>()
search.value?.widget?.grabFocus()
```

```vue
<VEntry ref="search" v-model="query" />
```

Для императивного кода доступны структурные типы `Widget`, `WindowWidget`, `EntryWidget`, `RowWidget`, `ListBoxWidget`, `ButtonWidget`, `LabelWidget`, `ToggleWidget`. Публичные декларации не зависят от `.gir` файлов пользовательской машины. Gtk.Window.isActive() объявлен как метод с учётом особенностей node-gtk.

## CSS и расширение

`<style>` принимает GTK CSS. `<style scoped>` преобразует Vue scope attributes в GTK CSS classes. CSS provider живёт в scope компонента и удаляется при unmount. `class` и `style` bindings работают; inline style использует отдельный provider. Значения CSS должны быть допустимы для GTK, например `min-height: 44px`. Ошибки CSS не скрываются.

```ts
import Adw from 'gi:Adw-1'
import { registerWidget, defineWidgetComponent } from 'vio'

registerWidget('clamp', { create: () => new Adw.Clamp(), children: 'single' })
export const VClamp = defineWidgetComponent('VClamp', 'clamp')
```

`createRoot(existingGtkBox)` позволяет встроить Vue subtree в существующий GTK контейнер. `createVioRenderer(driver)` из `vio/core` отделён от GI и используется в headless-тестах; `vio/core` не импортирует GTK.

## Границы первой версии

Поддерживаются Vue Composition/Options API, SFC, keyed lists, fragments, slots, component refs, lifecycle, `v-if`, `v-for`, `v-show` и `v-model` на VEntry. Здесь нет HTML layout engine: DOM directives (`v-html`, `v-text`), DOM event modifiers (`.prevent`, `.stop`), CSS preprocessors, external SFC blocks и browser transitions не поддерживаются. Для анимаций используются GTK API. Native HMR пока не реализован: после изменения `.vue` перезапустите нативный процесс.

## Разработка

Из корня Projector:

```bash
vp run vio:build
vp run vio:test
vp run vio:demo
vp run vio:gtk-test   # нужен доступ к desktop display
```

Сам пакет можно вынести из workspace: его manifest содержит собственные зависимости, build и test scripts. Перед сборкой GTK-декларации генерируются локально в `node_modules/.node-gtk-types`; в tarball входят готовые ESM и `.d.mts` exports, README, лицензия и пример.

Основой служит официальный [Vue custom renderer API](https://vuejs.org/api/custom-renderer.html). Пакет состоит из независимого reconciler (`vio/core`), GTK driver, Vue widget components и SFC compiler/Node loader. В нём нет imports или настроек Projector.
