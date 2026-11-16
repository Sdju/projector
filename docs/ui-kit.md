# UI-кит Projector

Цель UI-кита — сокращать код обычных форм, меню и панелей. Общий компонент должен убирать повторное оформление или поведение у нескольких реальных потребителей. Не добавляйте параметры только для воспроизведения каждого исторического CSS-отличия.

## Компоненты

Компоненты импортируются напрямую из `packages/client/common/ui`; общая папка не имеет barrel index.

| Задача           | Компоненты                                                     | Основные настройки                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Компоновка       | UiStack, UiInline, UiFormGrid                                  | gap, as, flow/wrap; FormGrid для адаптивной формы                                                                                                                      |
| Панели           | UiPanel, UiToolbar, UiScrollArea                               | sizing, gap; владелец выбирает зону прокрутки                                                                                                                          |
| Формы            | UiField, UiControl, UiControlScope                             | label/hint/error, native v-model, общая плотность                                                                                                                      |
| Выбор            | UiChoiceGroup, UiChoiceRow                                     | fieldset/legend, уникальное radio name через slot                                                                                                                      |
| Кнопки           | UiButton                                                       | appearance, tone, shape, size, busy                                                                                                                                    |
| Меню и строки    | UiActionRow, UiActionCopy                                      | interaction, tone, title/description                                                                                                                                   |
| Диалоги и popup  | UiDialog, UiDialogActions, UiPopupSurface, UiIsland, UiTooltip | оболочка и компоновка; focus/lifecycle у владельца; UiTooltip — подсказка по hover/focus (popover + CSS anchor positioning), текст в slot `content`                    |
| Части меню       | UiIslandHeader, UiIslandLabel, UiIslandFooter                  | заголовок, подпись, footer                                                                                                                                             |
| Текст и feedback | UiHeading, UiLabel, UiHint, UiMessage, UiEmpty                 | размер, отступ, tone; role задаёт владелец                                                                                                                             |
| Показатели       | UiStat                                                         | label/value/hint/delta, size, frame для ячейки; общий вид виджета Stat и итогов аналитики                                                                              |
| Загрузка         | UiLoader, UiSpinner, UiSkeleton                                | UiLoader — спиннер, текст и live-region для любого ожидания; UiSpinner — только глиф для микросостояния; UiSkeleton — форма ещё не загруженного блока                  |
| Статус           | UiBadge, UiStatusDot, UiAvatar, UiKbd, UiNoticeHost            | оформление без знания доменных статусов; UiAvatar — картинка с буквой-запасом, UiKbd — клавиша, UiNoticeHost — слой тултипов и карточек ошибок `notice.ts`             |
| Графики          | UiMeter, UiDonut, UiLineChart, useChartLayout                  | прогресс и кольцо с долями; линейный график с общей осью, `niceMax` и прореживанием подписей; `useChartLayout` — ResizeObserver, масштаб и тики для остальных диаграмм |
| Списки           | UiStringList, UiVirtualList                                    | редактируемый список строк (`items`, `validate`, `unique`); виртуализация — [virtualization](virtualization.md)                                                        |
| Содержимое       | UiCard, UiTable, UiDisclosureSummary                           | рамка, native table, native summary                                                                                                                                    |
| Resize           | UiResizeHandle, usePointerDrag                                 | capture/cleanup общие; clamp/rollback/keyboard у владельца                                                                                                             |

`UiButton` имеет один API: appearance `outline | solid | quiet`, tone `neutral | muted | danger`, shape `rect | icon | chip | pill`, size `sm | md`. По умолчанию — outline/neutral/rect/md; icon — quiet/muted. Для иконки задавайте `aria-label`. `type` по умолчанию button; submit/reset задаются явно. `busy` блокирует кнопку и сохраняет место под содержимое. `active` — оформление; `aria-pressed` нужен только настоящему toggle.

`UiControl` рендерит один native input/select/textarea, передаёт атрибуты и события, поддерживает v-model и modifiers. Ref предоставляет `element`, `focus()` и `select()`. `UiField` выдаёт через slot атрибуты связи label/control/hint/error. Не привязывайте контрол к служебным классам соседней формы.

`UiLoader` — единственный маркер ожидания в интерфейсе: спиннер, подпись и `role="status"` с `aria-live`. Для текста «загрузка», «читаю», «открываю» используйте его, а не отдельный `<p>`; `UiSpinner` остаётся низкоуровневым глифом внутри кнопки, вкладки или строки статуса. Ошибки и пустые состояния — по-прежнему `UiMessage`, `UiHint` и `UiEmpty`: `UiLoader` не решает, когда загрузка закончилась. Виджет проекта, который ждёт данные или скрипт, и экран открытия проекта используют тот же `UiLoader`; `UiSkeleton` остаётся формой ещё не загруженного блока.

`UiStat` — одна подпись с числом, изменением и пояснением: виджет `Stat`, итоги аналитики и карточка дня используют общую сетку и типографику. `frame` рисует границу ячейки, `size` задаёт размер значения; форматирование значений и тексты остаются у владельца.

`UiLineChart` — общий движок линий для виджета `Line` и аналитики: одна шкала с `niceMax`, прореживание подписей, ResizeObserver, формат значений и пустое состояние. Виджет включает интерактивный режим с кистью, миникартой и подсказкой; аналитика — лёгкую линию с заливкой. `UiBarChart` нет намеренно: виджет `Bars` — горизонтальный список с `UiMeter`, а `UsageBarChart` — вертикальные стековые столбцы по времени; общий у них только `useChartLayout`, а не геометрия. `UiDonut` и `UiMeter` используют одинаково и виджеты, и аналитика.

```vue
<UiStack as="form" @submit.prevent="save">
  <UiField v-slot="{ control }" label="Название" :error="error">
    <UiControl v-bind="control" v-model="name" required />
  </UiField>
  <UiDialogActions>
    <UiButton @click="cancel">Отмена</UiButton>
    <UiButton type="submit" appearance="solid" :busy="saving">Сохранить</UiButton>
  </UiDialogActions>
</UiStack>
```

```vue
<UiPanel>
  <UiToolbar justify="between">
    <span>Файлы</span>
    <UiButton shape="icon" size="sm" aria-label="Обновить" @click="refresh">
      <RefreshIcon />
    </UiButton>
  </UiToolbar>
  <UiScrollArea><slot /></UiScrollArea>
</UiPanel>
```

В примерах `save`/`cancel`/`refresh` обозначают обработчики владельца. Действия продукта вызываются через зарегистрированные `ide.*` команды.

## Границы

- Используйте общий компонент, если он сокращает суммарный код. Не заменяйте простой native tag универсальной конфигурацией ради отсутствия CSS.
- Layout проекта, responsive rules, виртуализация, drag дерева и внешние DOM-контракты CodeMirror/Milkdown/xterm остаются у владельцев. Локальный CSS для таких задач нормален.
- Общее оформление использует токены темы из `packages/client/app/styles.css`. Не создавайте глобальный токен для единственной геометрии.
- API, команды, состояния загрузки, popup focus policy и domain status mapping не входят в визуальные примитивы.
- Сохраняйте native label, form, button и summary semantics. При переносе element ref используйте `.element` вместо Vue instance.

## Цветовые схемы

Токены темы живут в `packages/client/app/styles.css`. Тёмная схема — значения в `:root`, светлая и высококонтрастная — блоки `[data-theme="light"]` и `[data-theme="contrast"]` в том же файле. Схема задаёт только 25 цветовых и теневых токенов и `color-scheme`; типографика, радиусы, отступы и слои общие. `--hover` и `--active` выводятся из `--text`, поэтому работают на любой яркости. Подсветка кода использует `--syntax-*` — алиасы семантических токенов, поэтому редактор и блоки кода Markdown следуют схеме, а `one-dark` остаётся явной тёмной темой.

Выбор хранится на диске в `appearance.json` (`$XDG_DATA_HOME/projector`), API — `GET/PUT /api/appearance`. В файле рядом со схемой лежат размеры шрифта контента (`fonts.chat` / `fonts.editor` / `fonts.terminal`, 11–20 px) — это не масштаб UI. Встроенные схемы — `dark`, `light`, `contrast` и `auto` (следует за `prefers-color-scheme`); включённые плагины добавляют внешние ID тем. `PUT` принимает `choice` и/или частичный `fonts`. Перед первым кадром `<head>` загружает блокирующий `GET /api/appearance/bootstrap.js`: сервер читает файл на каждый запрос и отдаёт короткий скрипт, который выставляет `data-appearance`, `data-theme`, `color-scheme`, `theme-color`, `--chat-fs` и переключает брендовые ссылки. Favicon, Apple touch icon, `theme-color` и манифест PWA следуют схеме: для светлой темы используются `favicon-light.svg`, `icons/*-light.png` и `manifest-light.webmanifest`. Это рантайм-механизм: смена оформления не требует пересборки или перезапуска, а страница не зависит от того, кто отдаёт `index.html`. Клиент обновляет `data-theme`, `<meta name="theme-color">` и брендовые ссылки при смене схемы и при изменении системной темы.

Проект может переопределить схему и шрифты файлом `.projector/appearance.json` (частичный override: незаданные поля наследуют глобальные). Файл действует только после доверия к его хешу (`appearance-trust.json`); API — `GET/PUT /api/projects/:id/appearance` и `PUT …/trust`. На странице проекта клиент применяет merge; при уходе с проекта возвращается глобальное оформление.

Внешние схемы поставляют локальные theme-only плагины: включённый пакет даёт проверенный набор тех же токенов, который применяется к `<html>` и сохраняется по ID `<package>/<theme>`. Исполняемого кода и других видов вкладов у таких плагинов нет; манифест, установка и API описаны в [plugins](plugins.md).

Пользовательские схемы лежат в `$XDG_DATA_HOME/projector/themes/` как `.json` или `.css`; ID — `user/<имя файла>` (строчные латинские буквы, цифры, `.`, `_`, `-`). JSON: `{ "title", "mode": "light|dark", "tokens": { … } }`. CSS: только `:root { --bg: …; … }` с полным набором токенов; необязательные комментарии `/* title: … */`, `/* mode: light|dark */`, `/* description: … */`. Значения проходят ту же проверку, что и темы плагинов: без `url()`, скриптов и произвольных селекторов. Невалидные файлы пропускаются, каталог читается заново при каждом `/api/appearance` и `/api/appearance/bootstrap.js`.

Компоненты не пишут цвета литералами. Если потребитель не умеет CSS (CodeMirror, xterm, canvas), он читает токены через `getComputedStyle` или получает отдельную группу токенов — но не дублирует палитру схемы. GTK-палитра `@zede/vio` остаётся нативной и следует системной теме GTK; веб-схема на неё не влияет.

## Проверки

Короткие browser tests проверяют native ввод/IME/modifiers/form/ref и взаимодействие кнопок, связей label и pointer cleanup:

```bash
vp test run tests/ui-kit-controls.test.mjs tests/ui-kit-primitives.test.mjs
vp run build
```

Нужен установленный Chromium; без него browser tests пропускаются. Fixtures используют отдельный профиль и сервер, не меняют настройки Projector.

Для визуального изменения проверяйте затронутый экран на обычной и узкой ширине и его реальное взаимодействие. Автоматизируйте воспроизводимый риск, а не каждый цвет и отступ. Для layout/panel изменений проверяйте resize и сохранение editor/terminal state; для popup — focus, Escape и правый клик. Побайтовые скриншоты и frozen-копии экранов не используем: они делают общий check медленным и нестабильным.

Общий gate остаётся `vp run check`; перед коммитом — Oxfmt через `vp fmt` и `git diff --check`. Тесты UI-кита не должны превращаться в отдельный длительный gate или копию реализации.
