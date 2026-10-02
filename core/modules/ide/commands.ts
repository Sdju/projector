export type ContextValue = string | boolean | number | null;
export type CommandContext = Record<string, ContextValue>;
export interface Keybinding {
  key: string;
  command: string;
  when?: CommandContext;
  args?: unknown;
  disabled?: boolean;
  allowInput?: boolean;
}
export interface KeyStroke {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}
export interface CommandRegistration {
  palette?: boolean;
  id: string;
  title: string;
  run: (args?: unknown) => unknown;
  enabled?: (args?: unknown) => boolean;
}
export interface CommandInfo {
  palette?: boolean;
  id: string;
  title: string;
  scope: string;
  enabled: boolean;
  shortcut?: string;
}
export function matchesContext(when: CommandContext | undefined, context: CommandContext) {
  return !when || Object.entries(when).every(([key, value]) => context[key] === value);
}
export function matchesKey(key: string, event: KeyStroke) {
  const parts = key.toLowerCase().split("+");
  const name = parts.pop();
  const mod = parts.includes("mod");
  return (
    (name === event.key.toLowerCase() || (name === "space" && event.key === " ")) &&
    (mod ? !!(event.ctrlKey || event.metaKey) : !!event.ctrlKey === parts.includes("ctrl")) &&
    (mod ? !(event.ctrlKey && event.metaKey) : !!event.metaKey === parts.includes("meta")) &&
    !!event.altKey === parts.includes("alt") &&
    !!event.shiftKey === parts.includes("shift")
  );
}
export function parseKeybindings(value: unknown): Keybinding[] {
  if (!Array.isArray(value) || value.length > 500)
    throw new Error("Ожидается список до 500 привязок");
  return value.map((item) => {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.command !== "string" ||
      !item.command.trim() ||
      typeof item.key !== "string" ||
      !item.key.trim()
    )
      throw new Error("Укажите command и key для каждой привязки");
    const parts = item.key.split("+");
    if (
      !parts.at(-1) ||
      parts
        .slice(0, -1)
        .some(
          (part: string) => !["mod", "ctrl", "meta", "alt", "shift"].includes(part.toLowerCase()),
        ) ||
      new Set(parts.map((part: string) => part.toLowerCase())).size !== parts.length ||
      (parts.some((part: string) => part.toLowerCase() === "mod") &&
        parts.some((part: string) => ["ctrl", "meta"].includes(part.toLowerCase())))
    )
      throw new Error(`Некорректная клавиша: ${item.key}`);
    if (
      item.when !== undefined &&
      (!item.when ||
        Array.isArray(item.when) ||
        typeof item.when !== "object" ||
        Object.values(item.when).some(
          (value) => value !== null && !["string", "boolean", "number"].includes(typeof value),
        ))
    )
      throw new Error("when должен содержать значения ключей контекста");
    for (const field of ["disabled", "allowInput"])
      if (item[field] !== undefined && typeof item[field] !== "boolean")
        throw new Error(`${field} должен быть boolean`);
    return {
      key: item.key,
      command: item.command,
      ...(item.when === undefined ? {} : { when: { ...item.when } }),
      ...(item.args === undefined ? {} : { args: item.args }),
      ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
      ...(item.allowInput === undefined ? {} : { allowInput: item.allowInput }),
    };
  });
}
export function createCommandService(defaults: Keybinding[] = []) {
  const scopes = new Map<
    string,
    { context: () => CommandContext; commands: Map<string, CommandRegistration> }
  >();
  const listeners = new Set<() => void>();
  let overrides: Keybinding[] = [];
  let activeScope = "";
  const notify = () => {
    for (const listener of listeners) listener();
  };
  // A user entry replaces this command's default bindings, including explicit unbinding.
  const bindings = () =>
    [
      ...defaults.filter((rule) => !overrides.some((entry) => entry.command === rule.command)),
      ...overrides,
    ].filter((rule) => !rule.disabled);
  function describe(scope: string, id: string, args?: unknown): CommandInfo | undefined {
    const entry = scopes.get(scope);
    const command = entry?.commands.get(id);
    if (!entry || !command) return;
    return {
      id,
      title: command.title,
      ...(command.palette === false ? { palette: false } : {}),
      scope,
      enabled: command.enabled?.(args) ?? true,
      shortcut: bindings()
        .findLast((rule) => rule.command === id && matchesContext(rule.when, entry.context()))
        ?.key.replace(/Mod/g, "Ctrl"),
    };
  }
  async function executeCommand<T = unknown>(
    id: string,
    args?: unknown,
    options: { scope?: string } = {},
  ): Promise<T> {
    const scope = options.scope ?? activeScope;
    const entry = scopes.get(scope);
    const command = entry?.commands.get(id);
    if (!command)
      throw new Error(
        `Команда ${id} не зарегистрирована в области ${scope || "(нет активной области)"}`,
      );
    if (!describe(scope, id, args)?.enabled) throw new Error(`Команда ${id} сейчас недоступна`);
    return (await command.run(args)) as T;
  }
  function createScope(id: string, context: () => CommandContext) {
    if (scopes.has(id)) throw new Error(`Область команд ${id} уже зарегистрирована`);
    const entry = { context, commands: new Map<string, CommandRegistration>() };
    scopes.set(id, entry);
    notify();
    return {
      id,
      activate() {
        activeScope = id;
      },
      registerCommand(command: CommandRegistration) {
        if (entry.commands.has(command.id))
          throw new Error(`Команда ${command.id} уже зарегистрирована`);
        entry.commands.set(command.id, command);
        notify();
        return () => {
          if (entry.commands.get(command.id) === command) {
            entry.commands.delete(command.id);
            notify();
          }
        };
      },
      describe: (command: string, args?: unknown) => describe(id, command, args),
      executeCommand: <T = unknown>(command: string, args?: unknown) =>
        executeCommand<T>(command, args, { scope: id }),
      resolveKeybinding(event: KeyStroke, inputFocus = false) {
        if (event.isComposing || event.repeat) return;
        const contextKeys = { ...context(), inputFocus };
        return bindings().findLast(
          (rule) =>
            (rule.allowInput || !inputFocus) &&
            matchesKey(rule.key, event) &&
            matchesContext(rule.when, contextKeys) &&
            describe(id, rule.command, rule.args)?.enabled,
        );
      },
      dispose() {
        if (scopes.get(id) === entry) {
          scopes.delete(id);
          if (activeScope === id) activeScope = "";
          notify();
        }
      },
    };
  }
  return {
    createScope,
    executeCommand,
    getCommands: () =>
      [...scopes.keys()].flatMap((scope) =>
        [...scopes.get(scope)!.commands.keys()].map((id) => describe(scope, id)!),
      ),
    getActiveScope: () => activeScope,
    getScopes: () => [...scopes.entries()].map(([id, scope]) => ({ id, context: scope.context() })),
    getKeybindings: () => structuredClone(bindings()),
    getDefaultKeybindings: () => structuredClone(defaults),
    getKeybindingOverrides: () => structuredClone(overrides),
    setKeybindings(value: unknown) {
      overrides = parseKeybindings(value);
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
