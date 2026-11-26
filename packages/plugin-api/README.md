# `@ai-projector/plugin-api`

Публичный контракт автора browser-плагина Projector: типы `Plugin`, `PluginApi`, `PluginStorageApi`,
`PluginViewContext`, `LanguageRegistration`, `PanelRegistration`, `TabRegistration` и helper
`definePlugin`. Пакет не импортирует client/server, Vue или CodeMirror.

Пакет **private** и не публикуется в npm. Его не нужно устанавливать из реестра; для внешнего
плагина используйте локальную копию или архив этого каталога.

## Локальная копия

В checkout Projector пакет уже связан pnpm workspace, поэтому пример импортирует его по имени:

```ts
import { definePlugin, type PluginApi } from "@ai-projector/plugin-api";
```

Для плагина вне репозитория скопируйте `packages/plugin-api` и объявите локальную зависимость:

```json
{
  "devDependencies": {
    "@ai-projector/plugin-api": "file:../projector/packages/plugin-api"
  }
}
```

Либо соберите архив из каталога SDK и поставьте его файлом:

```bash
cd packages/plugin-api
pnpm pack
mkdir -p /tmp/my-plugin/node_modules/@ai-projector
tar -xzf ai-projector-plugin-api-0.15.0.tgz \
  -C /tmp/my-plugin/node_modules/@ai-projector
mv /tmp/my-plugin/node_modules/@ai-projector/package /tmp/my-plugin/node_modules/@ai-projector/plugin-api
```

Ссылка на локальный каталог или tarball — единственный поддерживаемый способ. Имя и версия
манифеста не означают, что пакет опубликован.

## Использование

`definePlugin` — identity helper; runtime также принимает обычный объект. Импорт `definePlugin`
попадает в ESM-артефакт, а типы стираются компилятором. Если нужен минимальный bundle, helper можно
не использовать:

```ts
import type { Plugin } from "@ai-projector/plugin-api";

const plugin: Plugin = {
  apiVersion: 1,
  activate(api) {
    api.languages.register({ id: "my-language", rules: [{ pattern: "\\w+", token: "keyword" }] });
  },
};

export default plugin;
```

Собственные команды регистрируйте в `api.commands.prefix + "..."`: это reserved-пространство
пакета, встроенные команды им не перекрываются. `api.assetUrl("chunk.js")` считает путь от каталога
артефактов (`dist/`), а не от корня пакета. UI монтируется через `mount(container, context)`;
`context.commands.run` возвращает Promise и ошибки команды, `context.workspace.openFile/openTab`
работают через workspace выбранного устройства.

`api.storage` — плоский ключ-значение пакета на устройстве, где он установлен: `get`, `set`,
`delete`, `keys`. Значения сериализуются в JSON, все ключи вместе ограничены 1 МБ; это открытый
файл с режимом `0600`, а не секретное хранилище. Данные переживают выключение и смену версии и
удаляются вместе с управляемой установкой.

`api.httpUrl(path)` возвращает device-aware адрес под префиксом пакета: путь проверяется на
безопасную форму, а существует ли такой маршрут, решает сервер.

Языковая грамматика — ordered regex-правила на одну строку: без cross-line состояния, parser tree,
indent/fold и произвольных CodeMirror extensions. `caseInsensitive` включает регистронезависимый
режим.

API передаёт host, глобального singleton нет. Browser-код доверенный и выполняется на origin
страницы/Hub; это не sandbox. Node-возможностей у него нет.

### Виджет настроек цветовой схемы

Тема объявляет поля `settings` в `projector.contributes.themes`. В браузерном `activate(api)` можно
зарегистрировать собственный виджет для локального ID этой темы.

```ts
api.themeSettings.register({
  id: "paper",
  mount(root, context) {
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "Установить размытие 0";
    reset.onclick = async () => {
      try {
        const saved = await context.save({ softness: 0 });
        reset.textContent = `Размытие: ${saved.softness} px`;
      } catch (error) {
        reset.textContent = String(error);
      }
    };
    root.append(reset);
    return () => reset.remove();
  },
});
```

`getValues()` возвращает текущие значения с учётом defaults. `save(patch)` передаёт частичное
изменение в общий API оформления и возвращает принятые значения. При закрытии виджета, смене схемы
или отключении плагина хост прерывает `context.signal` и вызывает disposer. Формат полей описан
в [контракте тем](../../docs/ui-kit.md#настройки-схемы).
