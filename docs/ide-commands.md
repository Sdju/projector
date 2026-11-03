# IDE commands and keybindings

Projector executes user-visible actions through a shared command SDK. Menu entries, buttons and shortcuts invoke command IDs; the registered handler owns the behavior. Not everything is migrated: automatic saves, drag-and-drop transfer internals, editor text/formatting keymaps, terminal PTY input and system launcher shortcuts stay outside the registry.

The model follows the [VS Code command API](https://code.visualstudio.com/api/extension-guides/command): the command is independent of the way it is invoked. Projector's implementation and IDs are its own.

## Why every feature needs commands

The built-in agent works through this registry: it lists `getCommands()` and runs `executeCommand(...)` (`src/modules/agent/model/commands.ts`). A capability that exists only as a button or a private handler is invisible to it, and the agent quality depends directly on command coverage. When extending Projector:

- register each user-visible action as a command and make the UI (button, menu, shortcut) invoke that ID instead of duplicating the logic;
- give commands a clear `title` and a `description` that states arguments, effects and side effects (terminal loss, confirmations); the agent reads them to choose a command;
- support explicit arguments for anything a dialog would ask for, so the command can run without the UI;
- express unavailability through `enabled`, not by failing after the call (see `ide.workbench.server.mode.*`);
- keep the agent-facing hint list (`server/modules/agents/projector/agent-tools.ts`) in step when adding a command family;
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

## Network settings

The network settings section and LAN workspace panel each own a scope with `surface: "network"` and `view: "settings"` or `"panel"`. Discover its ID through `getScopes()`; drafts belong to that screen. The scope reports saved mode, readiness, busy state and password presence, never the password itself.

- `ide.network.refresh` rereads mode, password presence and addresses; resets the mode draft and retains the password draft. It also retries an initial load failure.
- `ide.network.save` accepts optional `mode: "local" | "lan"` and `password: string`. Omitted values use that screen's drafts; an empty password input preserves the existing password, while explicit `password: ""` removes it. Changing mode restarts the server and terminates terminals and child processes; changing only the password applies immediately.
- `ide.network.password.clear` removes the password and saves that screen's mode draft.
- `ide.network.address.copy` is registered in the LAN panel only; optional `address` selects one of its current LAN URLs, otherwise it uses the first.

Saving is unavailable until state loads and while another operation is running. API failures reject SDK execution and keep the password draft for retry. Unmount aborts pending requests and removes the scope.

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

Keys support `Mod`, `Ctrl`, `Meta`, `Alt`, `Shift` and a key name. `Mod` matches Ctrl or Meta. Extra modifiers prevent a match. Letter, digit and punctuation chords follow the physical key (`KeyboardEvent.code`, the US QWERTY position), so Ctrl+S is the same key on any layout. Named keys such as Enter, F2 and the arrows use `KeyboardEvent.key`. Business shortcuts ignore composing/repeated events and text input by default; a rule must explicitly set `allowInput: true` for editing surfaces. Tab-rename and file-name inputs therefore keep normal text editing. Platform editor formatting and navigation remain with their editors.

The settings endpoint is `GET /api/ide/keybindings` and same-origin `PUT /api/ide/keybindings` with `{ bindings: [...] }`. GET also returns the settings path. No localStorage is used.

## Limits and tests

The SDK is in-process: there is no arbitrary command-execution HTTP endpoint, and a remote automation transport would need its own authorization and argument validation. Command arguments and results are untyped (`description` and `arguments` are documentation for the agent). Native and CLI hosts do not reuse the registry yet.

Validation: `vp test run tests/ide.test.mjs tests/markdown-editor.test.mjs tests/workspace.test.mjs`, `vp run build`, and live Chromium SDK/shortcut scenarios.

## Keyboard shortcuts and command center

`ide.workbench.keybindings.open` opens the virtual **Горячие клавиши** tab; its row actions are commands `ide.keybindings.edit|remove|reset|save` (scope `{ surface: 'keybindings' }`; `getDefaultKeybindings()` returns a detached copy of defaults). Keyboard recording is isolated from editor commands.

`Ctrl+Shift+P` / `F1` runs `ide.workbench.commandPalette.open` (workbench scope, handled before editors and terminal input). The palette captures the originating scope (`getActiveScope()`), excludes other projects' commands, shows unavailable ones disabled, and executes with an explicit scope. Register `palette: false` for commands that need arguments supplied only by another UI (tab reorder, shortcut-row edits).

## Reading tabs

The agent sees workspace content as text through two read-only commands in the editor scope (`src/modules/workspace/lib/tab-reader.ts`):

- `ide.workbench.tabs.list` returns every open panel: `id`, `label`, `kind` (`file`, `diff`, `image`, `archive`, `binary`, `terminal`, virtual kinds), `path`, dock `group`, `active`/`focused`/`hidden`, `dirty` and the terminal `status`/`exitCode`.
- `ide.workbench.tab.read` with `{ id?, maxChars?, lines? }` returns the tab's text. Files include the unsaved draft; diffs return both versions; archives return the entry list; images, binaries and UI-only tabs return a `note` instead of text. Terminals are read on the server from the session's headless xterm (screen plus scrollback, no ANSI), so hidden tabs work too; `lines` selects the tail (default 200, max 2000). Output is truncated to `maxChars` (default 20000, max 100000) and reports `truncated`.

Every service (virtual) tab publishes a **live snapshot** for the agent: its view calls `useTabReadout` (`src/common/utilities/tab-readout.ts`, keyed by the tab via `TabReadoutScope`). `ide.workbench.tab.read` returns that text, then falls back to the kind's static `TabType.read(params, content)` (`src/modules/workspace-api/tabs.ts`) and finally to a "no text" note. The snapshot is lazy — it reflects the current selection, filters and loaded data (settings section and search, project form draft, keybindings, network mode, docker containers, commit details, issue/pull/discussion, repository, agent chat) without exposing secrets. The tab's own view owns the snapshot: a nested view (for example the keybindings section inside settings) never overrides the owner and is read only while the owner has nothing to report. Views that hold state are `keepAlive`, so an open but inactive/hidden tab still answers with its screen.

The terminal read is the `{ action: "read", lines }` POST on the terminal control WebSocket. It never writes to the PTY.

## Reload and server mode

Global `workbench` scope: `ide.workbench.pages.reload` reloads all same-origin pages (BroadcastChannel). `ide.workbench.server.restart` confirms, calls `POST /api/app/restart`, waits for a new PID in `/api/health` (60 s timeout), then reloads; `ide.workbench.server.mode.dev|prod` call `POST /api/app/mode` with `{ mode }` (detached `projector mode <mode>`, see [usage](usage.md)). All of them end terminals and child processes. `ide.workbench.pwa.install` opens the saved browser install prompt, `ide.workbench.fullscreen.toggle` uses the Fullscreen API (also in the mobile surface pill and the scope of every project workspace).

## Git commands

The `git:<projectId>` scope has `{ surface: 'git', projectId, path, staged, busy }`. File commands accept `{ path, staged }`; omitting them uses the context-menu target. `openFile` opens the current file separately from its comparison; diff tabs are `HEAD → index` (read-only) or `index → worktree` (editable).

Rows, headers and context menus use `ide.git.openDiff`, `ide.git.openFile`, `ide.git.stage`, `ide.git.unstage`, `ide.git.discard`, `ide.git.refresh`; `ide.git.group.toggle` `{ staged }` collapses the blocks; `ide.git.history.resize` `{ height? }` sets the History height (≥120) or returns it to content size.

For stage/unstage, `path` selects a file or directory prefix; `path: ""` selects the whole group. The host sends selected files in one batch, validated before any index write. `stage` adds files, `unstage` preserves working contents (including before the first commit), `discard` restores from the index and preserves staged changes; discard confirms, SDK may pass `{ path, confirm: true }`, untracked files move to `.projector-trash`. Conflicted files can be staged after resolving markers; discard/unstage and diff stay unavailable until then. Writes use `POST /api/projects/:id/workspace/git` with `{ action, path }` or `{ action, paths }`, serialize index operations and accept only changed files inside the project.

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
- `ide.git.commit.openTree` `{ hash }` opens **Файлы коммита @hash** in the sidebar: a read-only tree at that commit for sources with snapshot trees (local, GitHub, GitLab); close with `ide.workbench.section.close` `{ section }`;
- `ide.git.commit.openChanges` opens the changed files of a non-root commit against its first parent in the sidebar. The section is a `compare` file scope: paths carry A/M/D/R marks, clicking a row opens a read-only diff `parent → commit`; filtering and collapsing a single-child directory chain are shared with the merge request changes tree. It works for local repositories, GitHub and GitLab;
- `ide.workbench.tree.open` `{ rev }` or `{ from, to }` opens the same tree/changes section without an overview tab; useful for the agent and future revision pickers;
- `ide.workbench.tree.search` `{ rev, q, case?, word?, regex? }` searches a committed tree through `git grep` locally or GitLab blob search with `ref` and returns hits with paths, lines, columns and match offsets. GitLab needs Advanced Search; GitHub does not expose code search at a commit, so the command is unavailable there;
- `ide.git.commit.file.toggle` `{ path, open? }` and `ide.git.commit.files.toggleAll` `{ open? }` expand file code inside the overview tab (read lazily);
- `ide.git.commit.openFile` `{ path }` opens the current file; `ide.git.commit.open` `{ hash }` opens the **Коммит** overview
  tab (message, metadata, parents, every file with +/− lines); `ide.git.commit.copyHash` `{ hash }`.

`hash` may be abbreviated; without it the commit under the cursor is used. Reads use
`GET /api/projects/:id/workspace/log?skip&limit&q&all`, `commit?hash` and `commit-diff?hash&path`.
A comparison reads `changes?from&to` and `compare-file?from&to&path&originalPath`; the same parameters are added by `FileScope` for `tree`/`file` (`rev`). GitHub implements the comparison through its compare API and GitLab through `repository/compare`; the merge request panel still uses `pull-files`/`pull-diff` until the provider exposes a dedicated MR signal.
Commit contents are immutable, so the client caches them by hash; the list is re-read on every Git refresh with
the loaded extent. Merge commits are shown against their first parent, and files are limited to the project folder.
Commit diff tabs are history: staging, discarding or moving files never closes them.

## Project settings commands

The page registers scope `project:settings` with `{ surface: 'project', projectId, name, icon, url, mode, defaultCommandId, dirty }`.
Commands: `ide.project.settings.get`, `ide.project.settings.update` (`name`, `icon`, `url`, `mode`, `defaultCommandId`),
`ide.project.command.add|update|remove|setDefault|move|duplicate` for scenarios (run commands; by `id` or `name`) and
`ide.project.command.import` for missing `package.json` scripts. A scenario has a name, a command, and optional
`cwd` (folder inside the project; applies to runs on this machine, not to Docker or Dev Container runs), `url`
(its own address) and `mode` (`server` or `window`, otherwise the project's). Empty values clear them. Writes use the same validation and
`catalog.save` as the settings form, and are unavailable while the open settings tab has unsaved edits.
The chat agent uses them instead of editing Projector data files.

## Missing project folder

When a saved project's folder no longer exists, its page shows a recovery view instead of the workspace
and registers scope `project:missing` with `{ surface: 'project-missing', projectId, path }`.
Commands: `ide.project.directory.create` recreates the folder at the saved path and
`ide.project.directory.relocate` (`path`, optional `create`) moves the project to another folder
(`create: true` creates it first). The server side is `POST /api/projects/<id>/directory` with
`{ mode: 'create' }` or `{ mode: 'relocate', path, create? }`; `POST /api/projects/resolve` reports
`missing: true` for such a project. Relocating stops the project's processes and closes its terminals,
and refuses a path already used by another project.

## Projector chat agent

`ide.workbench.agent.open` opens one virtual **Агент** tab; switching to a file keeps an active request alive, closing the chat or leaving the project aborts it. The agent has `list_commands`, `describe_command` and `execute_command`: discovery reads the live browser registry, execution requires a prior description in the same request and rechecks availability. `command-request` delegates to the originating browser through SSE, `POST /api/agent/tool-result` answers with a single-use id, requests expire after 60 seconds, other projects and disposed registrations are rejected; agent HTTP routes require loopback and reject foreign origins.

The `bash` tool uses the OS adapter, defaults to the project directory, limits to 30 seconds and 256 KiB combined output, stops the process group on cancellation and excludes env names with KEY, TOKEN, SECRET, PASSWORD or CREDENTIAL. It runs with the user's permissions, not as a sandbox; with a Docker environment it runs inside the container, in a trusted Dev Container — through `devcontainer exec` ([docker](docker.md)).

### IDE MCP server for external agents

The optional `ide` feature gives Claude Code and ACP agents three tools (`list_commands`, `describe_command`, `execute_command`) through the stdio server `projector-ide`; it is passed inline, never written to project or agent configs, and runs with `PROJECTOR_PROJECT_ID` and `PROJECTOR_MCP_TOKEN_FILE` (`agent/ide-mcp.token`, `0600`). The page claims a request and answers through the same loopback API; the first answering page owns that MCP session. Details and limits — [agent-features](agent-features.md).

### Agent backends

`runAgent` (`server/modules/agent/registry.ts`) picks a backend by `backend` from `server/app/agents.ts` (`projector` by default, `claude-code`, `codex`, `opencode`, `cursor`, `kimi`). `AgentBackend` emits the shared events: `text`, `tool`, `tool-result`, `project`, `status`, `done`, `error`, `session`, `permission-request` (`detail` + `persistent`, answered via `POST /api/agent/tool-result` with `{ allow, always? }`, 10-minute single-use id; `always` only when the backend can honor it), `commands` (slash commands; ACP — from a promptless `session/new`, Claude Code — `GET /api/agent/commands`), `context` (`used`, `size`, `model?`, `compactAt?`, `categories?`, `cost?`), `thought`, `task` (contract in [architecture](architecture.md)), `question-request`, `run` (also `X-Agent-Run` and the 202 body, so a broken stream can rejoin), `checkpoint`, `worktree`, `command-request`, and `controls` at the start of a turn.

**Controls and sessions.** `AgentControl` (`controls.ts`: `id`, `category` `model|effort|mode|flag|other`, `current`, `options` with optional `group`) is rendered as received. ACP reads `configOptions` from `session/new`/`session/load` (`thought_level`→effort, `model_config`→flag, boolean → on/off, legacy `models`/`modes` fill gaps) and applies `selection` through `session/set_config_option`, `set_model` or `set_mode` before the prompt, model first; a refused value is skipped. Adapters may add `clientCapabilities` and `normalizeSelection`. Claude Code takes `model` aliases and `effort` natively. HTTP: `GET /api/agent/controls?backend&projectId` (ACP probe cached 5 minutes, probe session always tries `session/delete` then `session/close`), `GET /api/agent/sessions?backend&projectId`, `POST /api/agent/sessions/load|delete`, `GET/PUT /api/agent/defaults`; commands `ide.agent.controls.list`, `ide.agent.control.set`, `ide.agent.sessions.list`, `ide.agent.session.resume|delete` (`confirm: true`).

`projector` is the IDE assistant with catalog tools from `server/modules/agents/projector/tool-specs.ts`. `claude-code` uses the Agent SDK with its own prompt, tools, login, `CLAUDE.md` and settings; Projector adds only enabled features. Permission modes: `default`, `acceptEdits`, `auto` (SDK classifier), `bypassPermissions`. Requires a project; refused with Docker or Dev Container.

`codex`, `opencode`, `cursor`, `kimi` are ACP agents over stdio (`agents/<id>/`, programs `opencode acp`, `agent acp`, `kimi acp`, `codex-acp`; a global binary is preferred, otherwise `npx -y @agentclientprotocol/codex-acp` outside the project). One JSON-RPC client (`acp-client.ts`) maps `session/update` (`acp-events.ts`), resumes with `session/load` or starts `session/new`, answers `session/request_permission` and cancels with `session/cancel`. A fresh process per turn, never the user's sessions; refused in isolating environments. A new ACP agent = module with `index.ts` + `createAcpBackend`, `terminal` override, row in `server/app/agents.ts`, `ClientAgent` descriptor and row in `src/app/agents.ts`; a non-ACP agent exports `AgentBackend` and registers in the same two places.

### Фоновые агенты

Команды заданий регистрируются вместе с командами чатов (`model/job-commands.ts`) в scope проекта; пользователь и штатный агент видят одно и то же. Модель данных, API, безопасность и границы — [фоновые задания](agent-jobs.md).

## Общие настройки

`ide.workbench.settings.open` (**Открыть настройки Projector**) в scope `editor:<projectId>` открывает вкладку **Настройки** рядом с файлами. Повторный вызов фокусирует вкладку `settings:app`. Кнопки настроек в шапке, мобильном выборе проекта и сайдбаре вызывают ту же команду; она доступна через командный центр. Вкладка сохраняет черновики при переключении файлов и переносе между блоками; закрытие завершает её состояние. Вне проекта настройки доступны по `/settings`.

Внутри вкладки scope `settings` предоставляет `ide.settings.sections.list`, `ide.settings.section.open` (`{ id }`) и `ide.settings.search` (`{ query? }`). Эти команды доступны встроенному агенту; формы используют прежние серверные API хранения настроек.

## HTML-страницы

`ide.editor.html.reload` и `ide.editor.html.openInBrowser` работают с активным HTML-файлом или с вкладкой по `id`. Панель просмотра вызывает их через `TabHost.run`.

## Чат

The chat input (`AgentInput.vue`) is a CodeMirror editor with atomic chips (`MessagePart`: `text`, `file`, `image`, `command`); plain text always survives — `message` and history carry the text, `parts`/`content` carry chips. Files come from `@` search (`rg --files` + fuzzy ranking), tree drops (`application/x-projector-tree-entry`) and desktop drops (made relative when inside the project); images are pasted or dropped into `POST /api/agent/attachments` (10 MB; PNG, JPEG, GIF, WebP). `/` at the start suggests the agent's commands. Claude Code sends images as content blocks; ACP gets a `resource_link` per file and `image` blocks when `promptCapabilities.image` is set. When the last answer ends with `<IntelligentForm>`/`<Form>`, the composer shows it instead of the editor and the sent turn keeps `form: { source, values }`.

**Chat forks.** See [chat forks](chat-forks.md): `forkAt` copies turns, `before` puts the question into the new input, `after` copies the answer; Claude Code branches lazily at `tail`, ACP starts `detached`, Projector replays the prefix. Every non-empty chat is indexed in `chat_index`, so a closed tab reopens through `ide.workbench.<agent>.open { chatId, title }`; deleting a list entry is not implemented.

**Chat history, branches and rewind.** An answer ends with `checkpoint` (`{ tail }`). The user message carries its own UUID (`messageId`), Claude Code runs with `enableFileCheckpointing`, so `POST /api/agent/rewind-files` (`{ backend, projectId, sessionId, messageId, dryRun }`, page-only) resumes the session and calls `rewindFiles(messageId)`. A session grows only at its end: if the transcript moved past `tail`, `sessionAt` forks with `forkSession(upToMessageId)` and continues the fork; the old session stays untouched. Only Claude Code restores files. Editing a message keeps the replaced turns as `variants` (`slot`, up to 20), stored in SQLite (`history-store.ts`, `history.sqlite`): one row per turn, a fork is rows with one `parent`, a save rewrites only changed rows; old per-chat JSON is imported once (kept as `.bak`).

All chat commands are registered once per workspace (`registerAgentCommands` in `model/agent-commands.ts`, called from `ProjectWorkspace`) in the project's editor scope; each finds an open chat through `model/chat-registry.ts` (`chat` names one, otherwise the last): `ide.agent.chats.list|recent`, `ide.agent.turns.list`, `ide.agent.controls.menu.toggle`, `ide.agent.controls.list`, `ide.agent.control.set`, `ide.agent.sessions.list`, `ide.agent.session.resume|delete`, `ide.agent.chat.send|stop|edit|retry|fork|rewind|version.show|queue.list|queue.remove|export|inject|compact|isolate`, `ide.agent.form.show|text`, `ide.agent.worktree.status|merge|discard`, `ide.agent.mcp.list`. Open questions for isolated copies: show their files in the tree/editor, choose merge strategy, handle copies whose chat was closed, and switch isolation on automatically when another answer is running.
