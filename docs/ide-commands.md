# IDE commands and keybindings

Projector is moving toward an IDE that executes commands through a shared SDK. Menu entries, buttons and shortcuts invoke command IDs; the registered handler owns the behavior. This is the first migration slice: file-tree actions, file/terminal tabs, and explicit Markdown save/source switching.

The model follows the [VS Code command API](https://code.visualstudio.com/api/extension-guides/command): the command is independent of the way it is invoked. Projector's implementation and IDs are its own.

## Why every feature needs commands

The built-in agent works through this registry: it lists `getCommands()` and runs `executeCommand(...)` (`src/modules/agent/model/commands.ts`). A capability that exists only as a button or a private handler is invisible to it, and the agent quality depends directly on command coverage. When extending Projector:

- register each user-visible action as a command and make the UI (button, menu, shortcut) invoke that ID instead of duplicating the logic;
- give commands a clear `title` and a `description` that states arguments, effects and side effects (terminal loss, confirmations); the agent reads them to choose a command;
- support explicit arguments for anything a dialog would ask for, so the command can run without the UI;
- express unavailability through `enabled`, not by failing after the call (see `ide.workbench.server.mode.*`);
- keep the agent-facing hint list (`server/modules/agent/agent-tools.ts`) in step when adding a command family;
- use `palette: false` only for commands that cannot work without UI-supplied arguments.

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
const tree = ide
  .getScopes()
  .find(({ context }) => context.surface === "fileTree" && context.projectId === projectId);

const result = await ide.executeCommand(
  "ide.fileTree.file.rename",
  { path: "docs/old.md", name: "new.md" },
  { scope: tree.id },
);
// { source: 'docs/old.md', destination: 'docs/new.md' }
```

Explicit `name` performs creation, duplication or renaming without a name dialog. Deletion requires `{ path, confirm: true }` to execute without the confirmation dialog. Omitting these arguments uses interactive UI. Commands that open a dialog return after opening it; their eventual submission is a separate interaction. Direct filesystem command calls await the operation and reject on failure.

```js
await ide.executeCommand(
  "ide.fileTree.file.create",
  { directory: "docs", name: "new.md" },
  { scope: tree.id },
);

const tabs = ide.getScopes().find(({ context }) => context.namespace === "ide.workbench.tabs");
await ide.executeCommand("ide.workbench.tabs.closeOthers", { id: tabId }, { scope: tabs.id });
```

`getCommands()` returns IDs, scopes, titles, current availability and effective shortcut labels. IDs can be registered by further adapters with `createScope(...).registerCommand(...)`. The registry rejects duplicate IDs within a scope and rejects execution of missing or unavailable commands.

## Overrides

```js
await ide.saveKeybindings([
  {
    command: "ide.fileTree.file.rename",
    key: "F6",
    when: { surface: "fileTree", entryKind: "file" },
  },
  {
    command: "ide.editor.file.save",
    key: "Mod+Shift+S",
    when: { surface: "editor" },
    allowInput: true,
  },
]);
```

`saveKeybindings` validates and persists the entire override array, then updates the live resolver and menu labels. `setKeybindings` changes only the current host's memory. `reloadKeybindings` reads the file again. `saveKeybindings([])` restores defaults.

An override replaces all default bindings of its command. Multiple overrides can bind that command in different contexts. Use `{ command, key, disabled: true }` to unbind it. The last applicable rule wins a key collision. `when` is an object of exact context-key matches, not a JavaScript expression or the VS Code expression language. `args` passes arguments to the handler.

Keys support `Mod`, `Ctrl`, `Meta`, `Alt`, `Shift` and a `KeyboardEvent.key` name. `Mod` matches Ctrl or Meta. Extra modifiers prevent a match. Business shortcuts ignore composing/repeated events and text input by default; a rule must explicitly set `allowInput: true` for editing surfaces. Tab-rename and file-name inputs therefore keep normal text editing. Platform editor formatting and navigation remain with their editors.

The settings endpoint is `GET /api/ide/keybindings` and same-origin `PUT /api/ide/keybindings` with `{ bindings: [...] }`. GET also returns the settings path. No localStorage is used.

## Next migration slices

1. Move the remaining explicit terminal, search and project actions onto commands; keep process and filesystem services behind adapters.
2. Add typed per-command argument/result contracts, contribution metadata, and richer context conditions; add key chords only when a real workflow needs them.
3. Reuse the core registry from native/CLI hosts with their own focus and presentation adapters. A remote automation transport will need its own authorization and argument validation.

Automatic saves, drag-and-drop transfer internals, editor text/formatting keymaps, terminal PTY input and system launcher shortcuts are not all migrated in this slice. The SDK is currently in-process; there is no arbitrary command-execution HTTP endpoint.

Validation: `node --test tests/ide.test.mjs tests/markdown-editor.test.mjs tests/workspace.test.mjs tests/architecture.test.mjs`, `vp run build`, and live Chromium SDK/shortcut scenarios.

## Keyboard shortcuts tab

The keyboard button in the project sidebar executes `ide.workbench.keybindings.open` in the editor scope. It opens a single virtual **Горячие клавиши** tab beside files. That tab uses the same select, close, reorder and context-menu commands as file tabs; refresh, file save, rename and deletion skip its virtual content.

The editor discovers registered commands and default/user bindings from the SDK. Search matches titles, IDs, shortcuts and context conditions. Click a shortcut or the pencil to record a replacement; Tab moves to Save/Cancel, Escape cancels. The remove and reset buttons unbind a row or restore all default bindings of that command. Editing one row preserves the command's other rules, conditions, arguments and input-focus setting. Changes persist through `saveKeybindings`, then take effect immediately. Save errors stay visible and retain the previous live binding. The checkbox filters user overrides.

Settings actions are commands too: `ide.keybindings.edit`, `.remove`, `.reset` take `{ command, index }` for a visible row, and `.save` accepts the recorded shortcut. Their scope has `{ surface: 'keybindings' }`. `getDefaultKeybindings()` returns a detached copy of the defaults for reset/edit tools. Keyboard recording is isolated from editor commands so recording does not invoke the action being assigned.

## Command center

`Ctrl+Shift+P` (`Cmd+Shift+P` on macOS) or `F1` opens the command center through `ide.workbench.commandPalette.open`. Both are default keybinding rules and can be changed in the keyboard shortcuts tab. The workbench scope handles this shortcut before embedded editors or terminal input, while name dialogs and shortcut recording retain their own keys.

The palette searches command titles, IDs and areas, supports Arrow Up/Down, Enter, Escape and mouse selection, and restores focus on cancellation. It captures the originating SDK scope before focusing its input. Duplicate registrations prefer the originating scope and commands from other projects are excluded. Selection executes the stored command ID with its explicit scope; the SDK rechecks availability and reports failures through the host notification. Commands unavailable in the captured context remain visible but cannot be selected for execution.

`getActiveScope()` exposes the originating scope to command surfaces. Register `palette: false` for commands that require arguments supplied only by another UI, such as tab reorder and shortcut-row edits. Such commands remain in the SDK and keyboard settings, but are omitted from the command center.

To open it directly from an SDK client:

```js
await ide.executeCommand("ide.workbench.commandPalette.open", undefined, { scope: "workbench" });
```

## Reading tabs

The agent sees workspace content as text through two read-only commands in the editor scope (`src/modules/workspace/lib/tab-reader.ts`):

- `ide.workbench.tabs.list` returns every open panel: `id`, `label`, `kind` (`file`, `diff`, `image`, `archive`, `binary`, `terminal`, virtual kinds), `path`, dock `group`, `active`/`focused`/`hidden`, `dirty` and the terminal `status`/`exitCode`.
- `ide.workbench.tab.read` with `{ id?, maxChars?, lines? }` returns the tab's text. Files include the unsaved draft; diffs return both versions; archives return the entry list; images, binaries and UI-only tabs return a `note` instead of text. Terminals are read on the server from the session's headless xterm (screen plus scrollback, no ANSI), so hidden tabs work too; `lines` selects the tail (default 200, max 2000). Output is truncated to `maxChars` (default 20000, max 100000) and reports `truncated`.

The terminal read is the `{ action: "read", lines }` POST on the terminal control WebSocket. It never writes to the PTY.

## Reload commands

The global `workbench` scope registers `ide.workbench.pages.reload` (**Перезагрузить открытые страницы Projector**) and
`ide.workbench.server.restart` (**Перезапустить сервер и открытые страницы**). Both appear in the command center and
keyboard settings; no shortcut is assigned by default. They take no arguments.

Reload updates all Projector pages on the same origin using BroadcastChannel, without browser storage.
Restart asks for confirmation because it terminates all terminals and child processes, calls the existing
`POST /api/app/restart` endpoint, then waits for `/api/health` to report a different PID before reloading pages.
Each page retains its URL and normal unsaved-edit unload protection. Failed requests and a 60-second
startup timeout are shown by the IDE host; duplicate actions are disabled while waiting. Save edits before restarting.

### Server mode

`ide.workbench.server.mode.dev` (**Переключить сервер в режим dev (HMR)**) and `ide.workbench.server.mode.prod`
(**Переключить сервер в режим prod (сборка)**) switch between `vp dev` and the standalone Node server over `dist`. After confirmation the page
calls `POST /api/app/mode` with `{ mode }`; the server starts `projector mode <mode>` as a detached CLI process
(build for `prod`, then full restart — terminals and child processes end) and answers `202`. Pages wait for a new PID in
`/api/health` and reload; `mode` in that response reports the running mode. A build failure leaves the old server
running; the page reports the 60-second timeout, details are in `~/.local/share/projector/server.log`. The same switch is
available as `projector mode [dev|prod]` (see [usage](usage.md)).

## Git commands

The `git:<projectId>` scope has `{ surface: 'git', projectId, path, staged, busy }`.
Git rows, directory rows, group headers and their context menus use `ide.git.openDiff`, `ide.git.openFile`,
`ide.git.stage`, `ide.git.unstage`, `ide.git.discard` and `ide.git.refresh`.
`ide.git.group.toggle` `{ staged }` collapses or expands the Staged / Changed blocks.
The panel has two zones: Staged and Changed scroll together on top, History sits below them, and a single border
between the zones can be dragged (up grows History; arrow keys move it, `Shift` moves further, `Home` collapses History,
double click or `Enter` resets). Squeezing History to its minimum collapses it like `ide.git.history.toggle`; the next
expansion restores the fitted height. `ide.git.history.resize` `{ height? }` sets that height in pixels (at least 120)
or, without `height`, returns History to its content size. The size lives only in the open panel.
File commands accept `{ path, staged }`; omitting them uses the context-menu target.
`openFile` opens the current file separately from its comparison. Diff tabs show a
file-diff icon; their tooltip and breadcrumb identify HEAD → index or index → worktree.
Their context menu also offers `ide.editor.file.open`.

For stage/unstage, `path` selects a file or directory prefix; `path: ""` selects the whole group. The +/− buttons on rows and headers invoke the same commands. The host sends the selected files in one batch, validated before any index writes.

`stage` adds the selected files, `unstage` preserves their working contents
(including before the first commit), and `discard` restores working contents from
the index, preserving staged changes. Discard asks for confirmation; explicit SDK
clients may pass `{ path, confirm: true }`. Untracked files move to `.projector-trash`.
Conflicted files can be staged after resolving their markers; discard/unstage and
diff stay unavailable until the conflict is resolved. Changes refresh the Git and
file trees and remove obsolete comparisons. Writes use the same-origin
`POST /api/projects/:id/workspace/git` adapter with `{ action, path }` or `{ action, paths }` and serialize
index operations. Paths are restricted to individual changed files within the project.

### Git branches

The branch row at the top of the Git panel shows the current branch (or `HEAD · hash` while detached) with `↑N ↓M`
against its upstream; it opens a filterable list of local and remote branches. The scope context carries `branch`
and `branchesOpen`. Commands:

- `ide.git.branch.toggle`, `ide.git.branch.refresh`, `ide.git.branch.list` (returns branches with upstream, ahead/behind, last commit);
- `ide.git.branch.checkout` `{ name }` — a remote branch (`origin/x`) becomes a local tracking branch, or reuses the existing local one;
- `ide.git.branch.create` `{ name?, from?, checkout? }` — `from` is a branch or commit hash, default HEAD; without `name` it asks in a dialog;
- `ide.git.branch.rename` `{ name, newName? }` and `ide.git.branch.delete` `{ name, force?, confirm? }` (local branches only;
  the current branch cannot be deleted, an unmerged one needs `force`).

Open files are saved before HEAD moves and re-read afterwards; tabs whose file does not exist on the new branch close.
Git's own explanation (for example the files blocking a checkout) is shown as the error. Writes use
`POST /api/projects/:id/workspace/branch` with `{ action, name, newName, from, checkout, force }` and share the index write queue;
`GET .../workspace/branches` lists them.

### Git history

The collapsible **History** block of the Git panel lists commits (`git log --topo-order`) with a lane graph,
branch/tag badges, an `↑N ↓M` mark against the upstream and a hollow node for unpushed commits. The scope context also
carries `commit`, `commitPath` and `historyOpen`. Commands:

- `ide.git.history.toggle`, `ide.git.history.refresh`, `ide.git.history.more`;
- `ide.git.history.filter` `{ query?, all? }` — message search, `@name` searches authors, `all` includes every branch;
- `ide.git.commit.toggle` `{ hash }` expands the changes made by that commit only;
- `ide.git.commit.openDiff` `{ hash, path }` opens a read-only diff `parent → commit` (tab title shows both hashes);
- `ide.git.commit.file.toggle` `{ path, open? }` and `ide.git.commit.files.toggleAll` `{ open? }` expand the code of files
  right inside the overview tab (read lazily, short files get a short viewer). The handle under each viewer resizes it
  (drag, arrows, double click resets); squeezing it to the minimum collapses the file like `file.toggle { open: false }`,
  and the next expansion restores the remembered height;
- `ide.git.commit.openFile` `{ path }` opens the current file; `ide.git.commit.open` `{ hash }` opens the **Коммит** overview
  tab (message, metadata, parents, every file with +/− lines); `ide.git.commit.copyHash` `{ hash }`.

`hash` may be abbreviated; without it the commit under the cursor is used. Reads use
`GET /api/projects/:id/workspace/log?skip&limit&q&all`, `commit?hash` and `commit-diff?hash&path`.
Commit contents are immutable, so the client caches them by hash; the list is re-read on every Git refresh with
the loaded extent. Merge commits are shown against their first parent, and files are limited to the project folder.
Commit diff tabs are history: staging, discarding or moving files never closes them.

## Project settings commands

The page registers scope `project:settings` with `{ surface: 'project', projectId, name, icon, url, mode, defaultCommandId, dirty }`.
Commands: `ide.project.settings.get`, `ide.project.settings.update` (`name`, `icon`, `url`, `mode`, `defaultCommandId`),
`ide.project.command.add|update|remove|setDefault` for run commands (tasks; by `id` or `name`) and
`ide.project.command.import` for missing `package.json` scripts. Writes use the same validation and
`catalog.save` as the settings form, and are unavailable while the open settings tab has unsaved edits.
The chat agent uses them instead of editing Projector data files.

## Projector chat agent

`ide.workbench.agent.open` opens a single virtual **Агент** tab beside files.
The sidebar robot button runs the same command. Switching to a file keeps an active
agent request alive; closing the chat or leaving the project aborts it.

The agent has `list_commands`, `describe_command` and `execute_command` tools.
Discovery reads the live browser registry for the current project and global
workbench/keybinding surfaces. Description returns argument documentation, scope
context and current availability. Execution requires a prior description in the
same request and calls the existing SDK with an explicit scope. The SDK rechecks
availability using supplied arguments. Tab scopes expose current tab IDs and labels
in their context. Extensions can provide `description` and `arguments` in command
registrations; built-in commands have shared documentation.

The SSE `command-request` event delegates discovery and execution to the originating
browser. `POST /api/agent/tool-result` returns a result using a single-use random
request ID. Requests expire after 60 seconds and are removed on disconnect. Other
projects' scopes and missing/disposed registrations are rejected. Agent HTTP routes
require a loopback host and reject foreign origins.

The `bash` tool uses the OS adapter and defaults to the current project directory.
It returns stdout, stderr and exitCode, limits execution to 30 seconds and combined
output to 256 KiB, and stops the process group on cancellation. Environment variables
whose names contain KEY, TOKEN, SECRET, PASSWORD or CREDENTIAL are excluded. Bash
runs with the user's filesystem permissions; it is not an isolated sandbox.
