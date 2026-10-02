# IDE commands and keybindings

Projector is moving toward an IDE that executes commands through a shared SDK. Menu entries, buttons and shortcuts invoke command IDs; the registered handler owns the behavior. This is the first migration slice: file-tree actions, file/terminal tabs, and explicit Markdown save/source switching.

The model follows the [VS Code command API](https://code.visualstudio.com/api/extension-guides/command): the command is independent of the way it is invoked. Projector's implementation and IDs are its own.

## Layers

- `core/modules/ide/index.ts`: platform-independent registry, execution, discovery, context matching, keybinding validation and resolution. No Vue, DOM or filesystem dependencies.
- `src/modules/ide/index.ts`: browser host, SDK exposure, error presentation and settings transport.
- `src/common/utilities/commands.ts`: UI port and Vue lifecycle adapter. Common components depend on this protocol; they do not import business modules.
- Components register scoped handlers. Menus carry `command` and `args`; shortcut labels are read from the resolver. The same availability check applies to menu, keybinding and SDK execution.
- `server/modules/ide`: serialized atomic persistence of overrides in `$XDG_DATA_HOME/projector/keybindings.json` (normally `~/.local/share/projector/keybindings.json`). The file is an array; missing means default bindings. Invalid settings produce an error and do not overwrite the live settings.

Scopes prevent a file-tab command from accidentally closing a terminal tab or acting on another project's tree. `getScopes()` reports each live scope and its context. Component unmount removes registrations. Explicit SDK calls should specify the scope; calls without a scope use the last activated scope.

## Browser SDK

```js
const ide = window.projector.ide;
const tree = ide.getScopes().find(({ context }) =>
  context.surface === 'fileTree' && context.projectId === projectId
);

const result = await ide.executeCommand(
  'ide.fileTree.file.rename',
  { path: 'docs/old.md', name: 'new.md' },
  { scope: tree.id },
);
// { source: 'docs/old.md', destination: 'docs/new.md' }
```

Explicit `name` performs creation, duplication or renaming without a name dialog. Deletion requires `{ path, confirm: true }` to execute without the confirmation dialog. Omitting these arguments uses interactive UI. Commands that open a dialog return after opening it; their eventual submission is a separate interaction. Direct filesystem command calls await the operation and reject on failure.

```js
await ide.executeCommand(
  'ide.fileTree.file.create',
  { directory: 'docs', name: 'new.md' },
  { scope: tree.id },
);

const tabs = ide.getScopes().find(({ context }) =>
  context.namespace === 'ide.editor.tabs'
);
await ide.executeCommand('ide.editor.tabs.closeOthers', { id: tabId }, { scope: tabs.id });
```

`getCommands()` returns IDs, scopes, titles, current availability and effective shortcut labels. IDs can be registered by further adapters with `createScope(...).registerCommand(...)`. The registry rejects duplicate IDs within a scope and rejects execution of missing or unavailable commands.

## Overrides

```js
await ide.saveKeybindings([
  {
    command: 'ide.fileTree.file.rename',
    key: 'F6',
    when: { surface: 'fileTree', entryKind: 'file' },
  },
  {
    command: 'ide.editor.file.save',
    key: 'Mod+Shift+S',
    when: { surface: 'editor' },
    allowInput: true,
  },
]);
```

`saveKeybindings` validates and persists the entire override array, then updates the live resolver and menu labels. `setKeybindings` changes only the current host's memory. `reloadKeybindings` reads the file again. `saveKeybindings([])` restores defaults.

An override replaces all default bindings of its command. Multiple overrides can bind that command in different contexts. Use `{ command, key, disabled: true }` to unbind it. The last applicable rule wins a key collision. `when` is an object of exact context-key matches, not a JavaScript expression or the VS Code expression language. `args` passes arguments to the handler.

Keys support `Mod`, `Ctrl`, `Meta`, `Alt`, `Shift` and a `KeyboardEvent.key` name. `Mod` matches Ctrl or Meta. Extra modifiers prevent a match. Business shortcuts ignore composing/repeated events and text input by default; a rule must explicitly set `allowInput: true` for editing surfaces. Tab-rename and file-name inputs therefore keep normal text editing. Platform editor formatting and navigation remain with their editors.

The settings endpoint is `GET /api/ide/keybindings` and same-origin `PUT /api/ide/keybindings` with `{ bindings: [...] }`. GET also returns the settings path. No localStorage is used.

## Next migration slices

1. Move the remaining explicit terminal, search, Git and project actions onto commands; keep process and filesystem services behind adapters.
2. Add a command palette using registry discovery.
3. Add typed per-command argument/result contracts, contribution metadata, and richer context conditions; add key chords only when a real workflow needs them.
4. Reuse the core registry from native/CLI hosts with their own focus and presentation adapters. A remote automation transport will need its own authorization and argument validation.

Automatic saves, drag-and-drop transfer internals, editor text/formatting keymaps, terminal PTY input and system launcher shortcuts are not all migrated in this slice. The SDK is currently in-process; there is no arbitrary command-execution HTTP endpoint.

Validation: `node --test tests/ide.test.mjs tests/markdown-editor.test.mjs tests/workspace.test.mjs tests/architecture.test.mjs`, `vp run build`, and live Chromium SDK/shortcut scenarios.

## Keyboard shortcuts tab

The keyboard button in the project sidebar executes `ide.workbench.keybindings.open` in the editor scope. It opens a single virtual **Горячие клавиши** tab beside files. That tab uses the same select, close, reorder and context-menu commands as file tabs; refresh, file save, rename and deletion skip its virtual content.

The editor discovers registered commands and default/user bindings from the SDK. Search matches titles, IDs, shortcuts and context conditions. Click a shortcut or the pencil to record a replacement; Tab moves to Save/Cancel, Escape cancels. The remove and reset buttons unbind a row or restore all default bindings of that command. Editing one row preserves the command's other rules, conditions, arguments and input-focus setting. Changes persist through `saveKeybindings`, then take effect immediately. Save errors stay visible and retain the previous live binding. The checkbox filters user overrides.

Settings actions are commands too: `ide.keybindings.edit`, `.remove`, `.reset` take `{ command, index }` for a visible row, and `.save` accepts the recorded shortcut. Their scope has `{ surface: 'keybindings' }`. `getDefaultKeybindings()` returns a detached copy of the defaults for reset/edit tools. Keyboard recording is isolated from editor commands so recording does not invoke the action being assigned.
