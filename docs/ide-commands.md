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

Global `workbench` scope: `ide.workbench.pages.reload` reloads all same-origin pages (BroadcastChannel). `ide.workbench.server.restart` confirms, calls `POST /api/app/restart`, waits for a new PID in `/api/health` (60 s timeout), then reloads; `ide.workbench.server.mode.dev|prod` call `POST /api/app/mode` with `{ mode }` (detached `projector mode <mode>`, see [usage](usage.md)). All of them end terminals and child processes.

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
runs with the user's filesystem permissions; it is not an isolated sandbox. In a project with a Docker environment it runs inside the container instead (see [containers](containers-design.md)); in a trusted Dev Container project, through `devcontainer exec`.

### Agent backends

`runAgent` (`server/modules/agent/registry.ts`) picks a backend by the request's `backend`: the agents registered in `server/app/agents.ts` (`projector` by default, `claude-code`, `codex`, `opencode`, `cursor`). Backends implement `AgentBackend` (`backend.ts`) and emit the shared SSE events (`AgentEventName` in `backend.ts`): `text`, `tool`, `tool-result`, `project`, `status`, `done`, `error`, plus `session` (native session ID, stored on the assistant turn and sent back as `sessionId`) and `permission-request` (a `detail` preview of the change and a `persistent` flag; answered through `POST /api/agent/tool-result` with `{ output: { allow, always? } }` — 10-minute expiry, single-use ID). A durable `always` answer is only offered when the backend can honor it. `commands` (`{ commands: [{ name, description?, hint? }] }`: slash commands an ACP agent lists while answering; Claude Code's are read before the first message from `GET /api/agent/commands`, which starts a promptless session for `supportedCommands()`) is how `/` in the input knows what to suggest. `context` (`{ used, size, model?, compactAt?, categories?, cost? }`: how full the context window is — read from the SDK's `getContextUsage` after each Claude Code turn, from `usage_update` for ACP agents; stored on the assistant turn and drawn as a ring beside the send button) is sent when the agent reports it. Further events: `thought` (the agent's reasoning, shown in a collapsible block), `task` (subagent and background-command patches of the `core/modules/agent-task` contract, see [architecture](architecture.md)), `question-request` (an agent question, ACP elicitation, answered like a permission), `run` (the id of the hosted run, stored in the history), `checkpoint` and `worktree` (described under chat history below), and `command-request` (delegates an IDE command to the browser). `controls` (the controls with the values actually in effect, described below) is sent at the start of every turn.

**Controls and sessions.** An agent describes what the user may tune as `AgentControl` data (`controls.ts`: `id`, `category` `model | effort | mode | other`, `current`, `options`), and the chat renders whatever it receives. For ACP agents `acp-controls.ts` reads `configOptions` from `session/new`/`session/load` (grouped selects are flattened, categories `model`, `thought_level`, `mode`; legacy `models`/`modes` fill in when absent) and `applySelection` sends the user's choice (`selection` in the request body) through `session/set_config_option`, `session/set_model` or `session/set_mode` before the prompt — model first, because it can change the other options; a refused value is skipped. Claude Code takes `model` (aliases) and `effort` natively. Optional `AgentBackend` methods serve the rest over HTTP: `GET /api/agent/controls?backend&projectId` (an ACP probe process, cached 5 minutes, its throwaway session deleted or closed), `GET /api/agent/sessions?backend&projectId` (the agent's own `session/list`, or the SDK's `listSessions`, newest first, untitled ones hidden), `POST /api/agent/sessions/load` (the replayed conversation as chat turns), `POST /api/agent/sessions/delete` (the SDK's `deleteSession` for Claude Code, `session/delete` for ACP agents that advertise it; published as `capabilities.deleteSessions`), and `GET/PUT /api/agent/defaults` (the last choice per backend in `launcher.json`). These are `ide.agent.controls.list`, `ide.agent.control.set`, `ide.agent.sessions.list`, `ide.agent.session.resume` and `ide.agent.session.delete` (needs `confirm: true`), registered with the other chat commands at the workspace (see below).

`projector` is the IDE assistant (OpenAI-compatible provider, `list/describe/execute_command`, catalog tools from `server/modules/agents/projector/tool-specs.ts`). `claude-code` is plain Claude Code through the Agent SDK: its own prompt, tools, login, `CLAUDE.md` and settings; Projector adds nothing to the model context. The chat UI is `AgentChat` with `backend="claude-code"`: tab kind `claude` (`ide.workbench.claude.open`, a new conversation per opening, history key `claude:<project>:<chatId>`), a **TUI/GUI** switch on the Claude Code row of the new-session menu and a section in settings (`agentModes` in `launcher.json`, TUI by default, only programs listed in `GUI_AGENT_PROGRAMS`; the row opens the terminal unless GUI is chosen), and a per-chat permission mode (`default` asks, `acceptEdits`, `auto` — the SDK's classifier approves safe calls and asks about risky ones, `bypassPermissions`). It requires a project and is refused in projects with a Docker environment or Dev Container.

`codex`, `opencode` and `cursor` are external agents driven through their **Agent Client Protocol** server over stdio (`server/modules/agents/acp/` with the program of each agent in its own folder: `agents/codex`, `agents/opencode`, `agents/cursor`): `opencode acp`, `agent acp` and Codex's `codex-acp` adapter (a global binary is preferred; otherwise `npx -y @agentclientprotocol/codex-acp` runs outside the project so its `package.json` cannot make npm refuse to start). One client speaks JSON-RPC 2.0 (`acp-client.ts`), maps `session/update` notifications onto the shared events (`acp-events.ts`), resumes with `session/load` or starts `session/new`, answers `session/request_permission` from the chat's allow/deny prompt and cancels through `session/cancel`. Each program keeps its own login, config and project rules; the process is spawned through `os.tools.spawnAgentProcess` (a fresh process per turn, never the user's own sessions) and, like Claude Code, is refused in isolating environments. Adding another ACP agent means one module under `server/modules/agents/` whose `index.ts` declares its program and calls `createAcpBackend` (models, modes, sessions and resume then work from its capabilities), its registration in `server/app/agents.ts`, a tab kind and the `GUI_AGENT_PROGRAMS`/`guiPrograms` lists; a non-ACP agent is a new module exporting an `AgentBackend`, registered in the same place.

### Фоновые агенты

Команды заданий регистрируются вместе с командами чатов (`model/job-commands.ts`) в scope проекта; пользователь и штатный агент видят одно и то же. Подробности и модель данных — [фоновые агенты](agent-background.md).

- `ide.agent.job.start` `{ agent, task, isolate?, mode? }` — запускает задание (`claude-code`, `codex`, `opencode`, `cursor`); изменяющая команда, штатный агент перед ней спрашивает подтверждение.
- `ide.agent.jobs.list` — задания проекта: состояние, запросы, файлы, начало итога.
- `ide.agent.job.result` `{ job, wait? }` — итог до 8000 символов; `wait` (до 45 с) держит ответ, пока состояние не сменится. Итог сверяют с `git diff`.
- `ide.agent.job.stop` `{ job }`, `ide.agent.job.answer` `{ job, answer, request? }` (`allow`, `always`, `deny` или текст ответа на вопрос; спрашивает подтверждение), `ide.agent.job.open` `{ job }` (вкладка `agent-job`, `ide.workbench.agent.job.open`).

Штатный агент поручает код фоновым агентам, не пишет его сам; независимые задачи отдаёт разным заданиям с `isolate: true`; копию вливает (`ide.agent.worktree.merge`) только по просьбе пользователя. `projector-guard` считает безопасными `result`, `list` и `open`, остальные команды заданий спрашивают подтверждение.

## Общие настройки

`ide.workbench.settings.open` (**Открыть настройки Projector**) в scope `editor:<projectId>` открывает вкладку **Настройки** рядом с файлами. Повторный вызов фокусирует вкладку `settings:app`. Кнопки настроек в шапке, мобильном выборе проекта и сайдбаре вызывают ту же команду; она доступна через командный центр. Вкладка сохраняет черновики при переключении файлов и переносе между блоками; закрытие завершает её состояние. Вне проекта настройки доступны по `/settings`.

Внутри вкладки scope `settings` предоставляет `ide.settings.sections.list`, `ide.settings.section.open` (`{ id }`) и `ide.settings.search` (`{ query? }`). Эти команды доступны встроенному агенту; формы используют прежние серверные API хранения настроек.

## HTML-страницы

`ide.editor.html.reload` и `ide.editor.html.openInBrowser` работают с активным HTML-файлом или с вкладкой по `id`. Панель просмотра вызывает их через `TabHost.run`.

### Message input

The chat input (`src/modules/agent/ui/AgentInput.vue`) is a CodeMirror editor whose content is text with **chips** between it (`MessagePart`: `text`, `file`, `image`, `command`; `lib/composer/chips.ts`). A chip is an atomic replaced range over the text it stands for (`@path`, `/name`, `[image]`), so plain text always survives: `message` and the history carry that text, `parts` (request) and `content` (stored user turn) carry the chips. Files come from `@` search (workspace action `paths`, `rg --files` plus fuzzy ranking in `server/modules/workspace/find-paths.ts`), from dropping tree entries (`application/x-projector-tree-entry`) or desktop files (made relative to the project root when inside it); images are pasted or dropped and uploaded to `POST /api/agent/attachments` (10 MB; PNG, JPEG, GIF, WebP; served from `GET /api/agent/attachments/<id>`); `/` at the very start of a message suggests the agent's commands. Backends: Claude Code sends images as content blocks of a streamed user message; ACP agents get a `resource_link` per file and `image` blocks when `promptCapabilities.image` is set.

**Chat history, branches and rewind.** An answer ends with a `checkpoint` event (`{ tail }`): the position of the answer's end in the agent's transcript (for Claude Code, the last transcript entry; read with `getSessionMessages` after the turn). The user message is sent with its own UUID (`messageId`), which Claude Code keeps in the transcript, and the SDK runs with `enableFileCheckpointing`, so `POST /api/agent/rewind-files` (`{ backend, projectId, sessionId, messageId, dryRun }`, page-only like attachments) can start the session again (`resume` + an idle prompt) and call `rewindFiles(messageId)`: it returns `{ ok, error?, files, insertions?, deletions? }` — a dry run lists what would change. A session only grows at its end, so a request carries `sessionId` and `tail`: if the transcript has moved past `tail` (the user went back and wrote something else), `sessionAt` (`claude-code-checkpoints.ts`) runs `forkSession(upToMessageId)` and continues the fork; the old session stays untouched. Only Claude Code can take files back (the other agents keep no backups). Other agents have no transcript to branch: a turn the chat was cut back to is marked `detached`, so the next request starts a new native session and replays the history as text. In the chat (`model/branches.ts`, `model/chat-actions.ts`) editing a message puts it in the input (`state.editing`; the turns it will replace are shown faded and nothing is cut), and sending it, like repeating an answer, cuts the turns from that message on and keeps them as `variants` of the new message (`slot` = the place of the shown version; at most 20 other versions); the history is stored in SQLite (`server/modules/agent/history-store.ts`, `agent/history.sqlite` in the data directory): one row per turn, a fork is several rows with one `parent`, `pick` remembers the shown version, and a save rewrites only the changed rows; `history.ts` validates the shape and imports the old per-chat JSON files once (kept as `.bak`). Messages sent while an answer runs wait in `state.queue` and go out after it; for Claude Code one can also be added to the running answer: its input stays open (`claude-code-input.ts`: a streamed prompt that accepts further user messages with `priority: "now"` through `POST /api/agent/inject`, closing 1.5 s after a result when nothing more arrives), and the note stays in the answer as the user's own bubble (a `note` part). A chat can start in an isolated copy of the project (`worktrees.ts`: the `isolate` request flag creates a `git worktree` under the data directory on branch `projector/<id>` and the agent's `cwd` is that folder, entered at the same subfolder; the `worktree` event stores `{ id, branch }` on the turn and later requests send the id, which the server resolves itself and never takes as a path; `GET /api/agent/worktree`, `POST /api/agent/worktree/merge` and `/discard`, page-only) — merging commits the copy's changes and runs `git merge` into the project's current branch, aborting and reporting on a conflict. ACP agents are given the project's `.mcp.json` servers in `session/new` (`mcp-config.ts`): stdio ones always, `http`/`sse` ones when the agent declares `mcpCapabilities`. After a stop or an error the queue waits for the user; `sendQueuedNow` stops the answer and sends one item at once. The chat also shows the plan (the last `TodoWrite`, `lib/plan.ts`), the files an answer changed (`lib/turn-changes.ts`, from the `Write`/`Edit`/`MultiEdit` inputs), subagent calls nested under their `Task` call (`parent` on the `tool` event), and a hint to `/compact` from 80% of the context. A hidden page gets a browser notification when an answer ends or a permission is asked (`lib/notify.ts`). Claude Code also takes `plan` as a permission mode, `budget` and `steps` controls (`maxBudgetUsd`, `maxTurns`), session renaming and pinning (`POST /api/agent/sessions/update`, SDK `renameSession`/`tagSession`) and offers "always allow", which saves the rule the SDK suggests into the user's settings (`updatedPermissions` with `destination: "userSettings"`). From 90% of the context the chat sends `/compact` itself once an answer ends, and the ring is refreshed during an answer (`getContextUsage` after tool results, at most every 4 s).

All chat commands are registered once per workspace, not by the chat component: `registerAgentCommands` (`model/agent-commands.ts`, called from `ProjectWorkspace`) puts them in the project's editor scope, and each finds an open chat through the registry the chat fills (`model/chat-registry.ts`; the argument `chat` names one, otherwise the chat used last): `ide.agent.chats.list`, `ide.agent.turns.list`, `ide.agent.controls.menu.toggle`, `ide.agent.controls.list`, `ide.agent.control.set`, `ide.agent.sessions.list`, `ide.agent.session.resume`, `ide.agent.session.delete`, `ide.agent.chat.send`, `ide.agent.chat.stop`, `ide.agent.chat.edit`, `ide.agent.chat.retry`, `ide.agent.chat.rewind`, `ide.agent.chat.version.show`, `ide.agent.chat.queue.list`, `ide.agent.chat.queue.remove`, `ide.agent.chat.export`, `ide.agent.chat.inject`, `ide.agent.chat.compact`, `ide.agent.chat.isolate`, `ide.agent.worktree.status`, `ide.agent.worktree.merge`, `ide.agent.worktree.discard` and `ide.agent.mcp.list` (`GET /api/agent/mcp`). Not decided yet for isolated copies: whether their files should show in the tree and editor, whether the merge strategy (merge, squash, patch) should be a choice, what to do with copies whose chat was closed without merging (they stay in the data directory until removed by hand), and whether isolation should switch on by itself when another answer is already running in the project.
