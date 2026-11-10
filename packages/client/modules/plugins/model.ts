import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import {
  commandArgs,
  optionalStringArg,
  useCommandScope,
} from "../../common/utilities/commands.ts";
import { pickFolder } from "../project/index.ts";
import { applyAppearance, currentAppearance, setAppearanceThemes } from "../appearance/index.ts";
import { fetchPlugins, pluginAction, saveAppearance, type PluginCatalog } from "./client.ts";

export function usePluginSettings() {
  const catalog = shallowRef<PluginCatalog>();
  const selectedId = ref("");
  const query = ref("");
  const mode = ref<"all" | "dark" | "light">("all");
  const installPath = ref("");
  const busy = ref(false);
  const error = ref("");
  const status = ref("");
  let disposed = false;

  const selected = computed(() =>
    catalog.value?.plugins.find((item) => item.id === selectedId.value),
  );
  const filtered = computed(() => {
    const needle = query.value.trim().toLocaleLowerCase();
    return (catalog.value?.plugins ?? []).filter((plugin) => {
      const matchesText = `${plugin.id} ${plugin.description ?? ""}`
        .toLocaleLowerCase()
        .includes(needle);
      return (
        matchesText &&
        (mode.value === "all" || plugin.themes.some((theme) => theme.mode === mode.value))
      );
    });
  });
  const commands = useCommandScope(`plugins:settings:${useId()}`, () => ({
    surface: "plugins",
    view: "settings",
    plugin: selectedId.value,
    query: query.value,
    mode: mode.value,
    ready: !!catalog.value,
    busy: busy.value,
  }));

  function accept(next: PluginCatalog) {
    if (disposed) return;
    catalog.value = next;
    setAppearanceThemes(next.availableThemes);
    applyAppearance(currentAppearance());
    if (selectedId.value && !next.plugins.some((item) => item.id === selectedId.value))
      selectedId.value = "";
  }

  async function perform(action: () => Promise<PluginCatalog | void>, success?: string) {
    if (disposed || busy.value) throw new Error("Дождитесь завершения операции с плагинами");
    busy.value = true;
    error.value = "";
    status.value = "";
    try {
      const next = await action();
      if (next) accept(next);
      if (success) status.value = success;
      return next;
    } catch (reason) {
      if (!disposed)
        error.value = reason instanceof Error ? reason.message : "Не удалось выполнить действие";
      throw reason;
    } finally {
      if (!disposed) busy.value = false;
    }
  }

  function load() {
    return perform(fetchPlugins);
  }

  function open(id: string) {
    if (!catalog.value?.plugins.some((item) => item.id === id)) throw new Error("Плагин не найден");
    selectedId.value = id;
    return catalog.value.plugins.find((item) => item.id === id);
  }

  function setEnabled(id: string, enabled: boolean) {
    const plugin = catalog.value?.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error("Плагин не найден");
    return perform(
      () => pluginAction(enabled ? "enable" : "disable", { id }),
      enabled ? "Плагин включён" : "Плагин выключен",
    );
  }

  async function applyTheme(id: string) {
    const theme = catalog.value?.availableThemes.find((item) => item.id === id);
    if (!theme) throw new Error("Тема недоступна: включите её плагин и обновите каталог");
    const previous = currentAppearance();
    applyAppearance(theme.id);
    try {
      await perform(() => saveAppearance(theme.id), `Тема «${theme.title}» применена`);
    } catch (reason) {
      if (!disposed) applyAppearance(previous);
      throw reason;
    }
    return theme;
  }

  async function install(path: string) {
    if (!path.trim()) throw new Error("Укажите путь к папке плагина");
    const next = await perform(
      () => pluginAction("install", { path: path.trim() }),
      "Плагин установлен и включён",
    );
    if (!disposed) installPath.value = "";
    return next;
  }

  async function chooseFolder() {
    const picked = await pickFolder();
    if (picked.cancelled || !picked.path) return;
    installPath.value = picked.path;
    return install(picked.path);
  }

  function themeArgument(value: unknown): string {
    const args = commandArgs(value);
    const id = optionalStringArg(args, "id");
    if (id) return id;
    const pluginId = optionalStringArg(args, "pluginId");
    const themeId = optionalStringArg(args, "themeId");
    if (!pluginId || !themeId) throw new Error("Укажите id или pluginId и themeId");
    return `${pluginId}/${themeId}`;
  }

  commands.scope.registerCommand({
    id: "ide.plugins.list",
    title: "Список локальных плагинов",
    description: "Возвращает локальные theme-only плагины, их статусы, диагностику и темы.",
    run: () => catalog.value?.plugins ?? [],
  });
  commands.scope.registerCommand({
    id: "ide.plugins.refresh",
    title: "Обновить каталог плагинов",
    description: "Заново читает локальные пакеты и обновляет доступные темы интерфейса.",
    enabled: () => !busy.value,
    run: load,
  });
  commands.scope.registerCommand({
    id: "ide.plugin.open",
    title: "Открыть карточку плагина",
    description: "Выбирает локальный плагин и показывает его темы и диагностику.",
    arguments: { id: "string: имя пакета плагина" },
    run: (value) => open(optionalStringArg(commandArgs(value), "id") ?? ""),
  });
  for (const enabled of [true, false]) {
    commands.scope.registerCommand({
      id: enabled ? "ide.plugin.enable" : "ide.plugin.disable",
      title: enabled ? "Включить плагин" : "Выключить плагин",
      description: enabled
        ? "Включает плагин и публикует его темы в настройках интерфейса."
        : "Выключает плагин и убирает его темы; активная внешняя тема временно заменяется тёмной.",
      arguments: { id: "string: имя пакета плагина" },
      enabled: () => !busy.value,
      run: (value) => setEnabled(optionalStringArg(commandArgs(value), "id") ?? "", enabled),
    });
  }
  commands.scope.registerCommand({
    id: "ide.plugin.theme.apply",
    title: "Применить тему плагина",
    description:
      "Применяет и сохраняет включённую внешнюю тему по полному id либо по pluginId и themeId; при ошибке возвращает прежнюю схему.",
    arguments: {
      id: "string: полный ID <package>/<theme>; альтернатива pluginId+themeId",
      pluginId: "string: имя пакета, используется вместе с themeId",
      themeId: "string: локальный ID темы, используется вместе с pluginId",
    },
    enabled: () => !busy.value,
    run: (value) => applyTheme(themeArgument(value)),
  });
  commands.scope.registerCommand({
    id: "ide.plugins.install",
    title: "Установить плагин из локальной папки",
    description:
      "Копирует проверенный theme-only пакет из указанной папки, включает его и обновляет каталог тем.",
    arguments: { path: "string: абсолютный путь к папке с package.json; без него — поле экрана" },
    enabled: () => !busy.value,
    run: (value) => install(optionalStringArg(commandArgs(value), "path") ?? installPath.value),
  });
  commands.scope.registerCommand({
    id: "ide.plugins.folder.open",
    title: "Выбрать и установить папку плагина",
    description: "Открывает системный выбор папки и устанавливает выбранный theme-only плагин.",
    enabled: () => !busy.value,
    run: chooseFolder,
  });

  onMounted(() => {
    void load().catch(() => {
      // The local error state leaves refresh available for retry.
    });
  });
  onBeforeUnmount(() => {
    disposed = true;
  });
  return {
    catalog,
    selected,
    selectedId,
    filtered,
    query,
    mode,
    installPath,
    busy,
    error,
    status,
    commands,
  };
}
