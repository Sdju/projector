import { inject, onBeforeUnmount, provide, ref, type InjectionKey, type Ref } from "vue";
import {
  createCommandService,
  defaultKeybindings,
  parseKeybindings,
  type Keybinding,
} from "../../../core/modules/ide/index.ts";
import { commandHostKey } from "../../common/utilities/commands.ts";
const ideKey: InjectionKey<{
  api: ReturnType<typeof createCommandService> & {
    reloadKeybindings: () => Promise<{
      path: string;
      bindings: Keybinding[];
    }>;
    saveKeybindings: (bindings: unknown) => Promise<unknown>;
  };
  revision: Ref<number>;
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
  const unsubscribe = sdk.subscribe(() => revision.value++);
  provide(commandHostKey, {
    revision,
    createScope: sdk.createScope,
    reportError: (value) => {
      error.value = value instanceof Error ? value.message : "Не удалось выполнить команду";
    },
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
  provide(ideKey, { api, revision });
  const browser = window as unknown as { projector?: { ide?: typeof api } };
  const previous = browser.projector?.ide;
  browser.projector ??= {};
  browser.projector.ide = api;
  void reloadKeybindings().catch((value) => {
    error.value = value instanceof Error ? value.message : String(value);
  });
  onBeforeUnmount(() => {
    unsubscribe();
    if (browser.projector?.ide === api) browser.projector.ide = previous;
  });
  return { error };
}
