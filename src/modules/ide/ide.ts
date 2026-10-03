import { inject, onBeforeUnmount, onMounted, provide, ref, type InjectionKey, type Ref } from "vue";
import {
  createCommandService,
  defaultKeybindings,
  parseKeybindings,
  type Keybinding,
  paletteCommands,
  type PaletteCommand,
} from "../../../core/modules/ide/index.ts";
import { commandHostKey } from "../../common/utilities/commands.ts";
import { createPageReload } from "./reload.ts";
interface PaletteSession {
  commands: PaletteCommand[];
  trigger: HTMLElement | null;
}
const ideKey: InjectionKey<{
  api: ReturnType<typeof createCommandService> & {
    reloadKeybindings: () => Promise<{
      path: string;
      bindings: Keybinding[];
    }>;
    saveKeybindings: (bindings: unknown) => Promise<unknown>;
  };
  revision: Ref<number>;
  palette: Ref<PaletteSession | null>;
  reportError: (value: unknown) => void;
}> = Symbol("ide");
export function useIdeCommands() {
  const host = inject(ideKey);
  if (!host) throw new Error("IDE SDK unavailable");
  return host;
}
export function provideIdeCommands() {
  const sdk = createCommandService(defaultKeybindings);
  const revision = ref(0);
  const error = ref("");
  const palette = ref<PaletteSession | null>(null);
  const reportError = (value: unknown) => {
    error.value = value instanceof Error ? value.message : "Не удалось выполнить команду";
  };
  const workbench = sdk.createScope("workbench", () => ({ surface: "workbench" }));
  const pageReload = createPageReload(reportError, () => revision.value++);
  workbench.registerCommand({
    id: "ide.workbench.pages.reload",
    title: "Перезагрузить открытые страницы Projector",
    description:
      "Обновляет все открытые страницы Projector на текущем адресе. Несохранённые изменения используют обычное подтверждение страницы.",
    enabled: () => !pageReload.isBusy(),
    run: () => pageReload.reloadPages(),
  });
  workbench.registerCommand({
    id: "ide.workbench.server.restart",
    title: "Перезапустить сервер и открытые страницы",
    description:
      "Запрашивает подтверждение, завершает терминалы и дочерние процессы, перезапускает сервер Projector и обновляет все открытые страницы после запуска нового процесса.",
    enabled: () => !pageReload.isBusy(),
    run: () => pageReload.restartServer(),
  });
  workbench.registerCommand({
    id: "ide.workbench.commandPalette.open",
    title: "Открыть командный центр",
    enabled: () => !!palette.value || !document.querySelector("dialog[open]"),
    run: () => {
      if (palette.value) return;
      palette.value = {
        commands: paletteCommands(sdk.getCommands(), sdk.getScopes(), sdk.getActiveScope()),
        trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      };
    },
  });
  function globalKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented || (document.querySelector("dialog[open]") && !palette.value))
      return;
    const target = event.target;
    const inputFocus =
      target instanceof Element &&
      !!target.closest('input,textarea,select,[contenteditable="true"]');
    const binding = workbench.resolveKeybinding(event, inputFocus);
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    // Calling this scope explicitly preserves the originating workspace scope.
    void workbench.executeCommand(binding.command, binding.args).catch(reportError);
  }
  onMounted(() => window.addEventListener("keydown", globalKeydown, true));
  const unsubscribe = sdk.subscribe(() => revision.value++);
  provide(commandHostKey, {
    revision,
    createScope: sdk.createScope,
    reportError,
  });
  async function reloadKeybindings() {
    const response = await fetch("/api/ide/keybindings");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось загрузить привязки клавиш");
    sdk.setKeybindings(data.bindings);
    return data;
  }
  async function saveKeybindings(bindings: unknown) {
    // Validate before writing; update the live resolver only after persistence succeeds.
    const validated = parseKeybindings(bindings);
    const response = await fetch("/api/ide/keybindings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bindings: validated }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Не удалось сохранить привязки клавиш");
    sdk.setKeybindings(data.bindings);
    return data;
  }
  const api = { ...sdk, reloadKeybindings, saveKeybindings };
  provide(ideKey, { api, revision, palette, reportError });
  const browser = window as unknown as { projector?: { ide?: typeof api } };
  const previous = browser.projector?.ide;
  browser.projector ??= {};
  browser.projector.ide = api;
  void reloadKeybindings().catch((value) => {
    error.value = value instanceof Error ? value.message : String(value);
  });
  onBeforeUnmount(() => {
    pageReload.dispose();
    unsubscribe();
    window.removeEventListener("keydown", globalKeydown, true);
    workbench.dispose();
    if (browser.projector?.ide === api) browser.projector.ide = previous;
  });
  return { error };
}
