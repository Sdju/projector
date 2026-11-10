# @ai-projector/ide

Projector web IDE: files, Git, terminals and agent chats in one local server. This package does not include the GTK palette.

## Install

```bash
npm install -g @ai-projector/ide
projector --browser
```

Open <http://localhost:4177> while Projector is running. Without `@ai-projector/native` the default launch mode opens the browser.

The CLI can drive projects without the UI:

```bash
projector open ~/code/app       # registers and opens a folder as a project
projector projects              # saved projects
projector status .              # server, project and process state
projector run . --command dev   # start the project command
projector stop .
projector search opencode
projector start | restart | quit
```

Use `--json` for machine-readable output. `projector open` also accepts a project id or name, `gh:/owner/repository` and `gl:/<instance>/<group>/<project>`.

Requirements: Node.js 24.11–24.x; on Linux, Python 3, `make` and a C++ compiler to build `node-pty`. Projector also uses `git`, `rg` and GNU `mv`.

To add a desktop entry and the `projector` command:

```bash
projector-install-desktop
```

Data and settings are stored in `$XDG_DATA_HOME/projector` (`~/.local/share/projector` by default).
