import { inject, onBeforeUnmount, type InjectionKey, type Ref } from "vue";
// UI port: common components know the command protocol, not the IDE implementation.
export interface CommandScope {
  id: string;
  activate(): void;
  registerCommand(command: {
    description?: string;
    arguments?: Record<string, string>;
    palette?: boolean;
    id: string;
    title: string;
    run: (args?: unknown) => unknown;
    enabled?: (args?: unknown) => boolean;
  }): () => void;
  describe(
    id: string,
    args?: unknown,
  ): { id: string; title: string; enabled: boolean; shortcut?: string } | undefined;
  executeCommand<T = unknown>(id: string, args?: unknown): Promise<T>;
  resolveKeybinding(
    event: KeyboardEvent,
    inputFocus?: boolean,
  ): { command: string; args?: unknown } | undefined;
  dispose(): void;
}
export interface CommandHost {
  revision: Ref<number>;
  createScope(
    id: string,
    context: () => Record<string, string | boolean | number | null>,
  ): CommandScope;
  reportError(error: unknown): void;
}
export const commandHostKey: InjectionKey<CommandHost> = Symbol("ide-commands");
export function useCommandScope(
  id: string,
  context: () => Record<string, string | boolean | number | null>,
) {
  const host = inject(commandHostKey);
  if (!host) throw new Error("IDE command host is not installed");
  const scope = host.createScope(id, context);
  onBeforeUnmount(() => scope.dispose());
  function run(id: string, args?: unknown) {
    scope.activate();
    void scope.executeCommand(id, args).catch(host!.reportError);
  }
  function keydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target;
    const inputFocus =
      target instanceof Element &&
      !!target.closest('input,textarea,select,[contenteditable="true"]');
    const binding = scope.resolveKeybinding(event, inputFocus);
    if (!binding) return;
    event.preventDefault();
    event.stopPropagation();
    run(binding.command, binding.args);
  }
  function item(
    id: string,
    args?: unknown,
    options: { label?: string; separator?: boolean; danger?: boolean } = {},
  ) {
    host!.revision.value;
    const command = scope.describe(id, args);
    if (!command) throw new Error(`Unknown menu command: ${id}`);
    return {
      id,
      label: options.label ?? command.title,
      shortcut: command.shortcut,
      disabled: !command.enabled,
      separator: options.separator,
      danger: options.danger,
      command: id,
      args,
      run: () => run(id, args),
    };
  }
  return { scope, run, keydown, item };
}
export function commandArgs(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Аргументы команды должны быть объектом");
  return value as Record<string, unknown>;
}

/** Регистрирует команды в чужом (родительском) scope и снимает их при размонтировании компонента. */
export function useCommandRegistrar(scope: CommandScope) {
  const disposers: (() => void)[] = [];
  onBeforeUnmount(() => disposers.forEach((dispose) => dispose()));
  return (
    id: string,
    title: string,
    description: string,
    run: (args?: unknown) => unknown,
    args?: Record<string, string>,
    enabled?: (args?: unknown) => boolean,
  ) => {
    disposers.push(
      scope.registerCommand({ id, title, description, arguments: args, run, enabled }),
    );
  };
}

/** Необязательный строковый аргумент команды; другой тип — ошибка. */
export function optionalStringArg(args: Record<string, unknown>, key: string) {
  const value = args[key];
  if (value !== undefined && typeof value !== "string")
    throw new Error(`${key} должен быть строкой`);
  return value as string | undefined;
}
