import { expect, test } from "vite-plus/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

/**
 * Guard for docs/agent-independence.md: common modules must not name concrete agents.
 *
 * Agent-specific knowledge lives in `server/modules/agents/**`,
 * `server/modules/agents-integration/**` and `src/modules/agents-integration/**`, which are not
 * scanned. Everything below is shared code and has to work through the registry/catalog.
 */
const SCANNED_DIRS = [
  "server/modules/agent",
  "server/modules/terminal",
  "core/modules/terminal",
  "core/modules/ide",
  "core/modules/os",
  "core/modules/os-posix",
  "src/modules/agent/model",
  "src/modules/agent/lib",
  "src/modules/agent/ui",
  "src/modules/workspace",
  "src/modules/workspace-api",
  "src/modules/app-settings",
];

/**
 * `cursor` is also a CSS/Codemirror word, so only its quoted form counts as an agent reference.
 * The letter boundaries keep words such as `openCoder` or identifiers like `readOpenCodeGoKey`
 * from matching by accident; real leaks there are caught by the module imports next to them.
 */
const AGENT_PATTERNS = [
  { name: "claude", pattern: /(?<![a-z0-9])claude(?![a-z0-9])/i },
  { name: "codex", pattern: /(?<![a-z0-9])codex(?![a-z0-9])/i },
  { name: "kimi", pattern: /(?<![a-z0-9])kimi(?![a-z0-9])/i },
  { name: "opencode", pattern: /(?<![a-z0-9])opencode(?![a-z0-9])/i },
  { name: "cursor", pattern: /["']cursor["']/i },
];

/**
 * Known violations when the guard was introduced (2026-10-30), file → agent names.
 * Every entry is a leak from the table in docs/agent-independence.md and must disappear together
 * with the matching phase:
 *
 * - `core/modules/os*` → phase 4 (credentials and session env move into agent modules);
 * - `core/modules/terminal`, `core/modules/ide`, `server/modules/terminal` → phase 3;
 * - `src/modules/{workspace,workspace-api,agent,app-settings}` → phase 2 and phase 6;
 * - client and server text/contract leaks → phases 2 and 5.
 *
 * Remove an entry in the same change that removes the leak. Never add one: a new name in shared
 * code has to be fixed, not allowlisted. By the end of phase 6 this map is empty.
 */
const BASELINE = new Map([
  ["core/modules/ide/command-help.ts", ["claude", "codex", "kimi", "opencode"]],
  ["core/modules/os-posix/codex.ts", ["codex"]],
  ["core/modules/os-posix/cursor.ts", ["cursor"]],
  ["core/modules/os-posix/index.ts", ["codex", "kimi", "opencode"]],
  ["core/modules/os-posix/kimi.ts", ["kimi"]],
  ["core/modules/os-posix/opencode.ts", ["opencode"]],
  ["core/modules/os/modules/windows/codex.ts", ["codex"]],
  ["core/modules/os/modules/windows/cursor.ts", ["cursor"]],
  ["core/modules/os/modules/windows/index.ts", ["codex", "kimi", "opencode"]],
  ["core/modules/os/modules/windows/kimi.ts", ["kimi"]],
  ["core/modules/os/modules/windows/opencode.ts", ["opencode"]],
  ["core/modules/os/session-env.ts", ["claude"]],
  ["core/modules/terminal/contract.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["server/modules/terminal/terminal.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/agent/lib/job-labels.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/agent/model/agent-commands.ts", ["claude"]],
  ["src/modules/agent/model/job-commands.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/agent/model/modes.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/agent/model/types.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/agent/ui/AgentIntegrationsSettings.vue", ["claude", "codex", "kimi", "opencode"]],
  ["src/modules/agent/ui/AgentSkillsSettings.vue", ["claude"]],
  ["src/modules/app-settings/sections.ts", ["claude", "codex", "kimi", "opencode"]],
  ["src/modules/workspace-api/local.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  ["src/modules/workspace/lib/tab-views.ts", ["claude", "codex", "kimi", "opencode", "cursor"]],
  [
    "src/modules/workspace/lib/workbench-layout.ts",
    ["claude", "codex", "kimi", "opencode", "cursor"],
  ],
  [
    "src/modules/workspace/ui/NewSessionMenu.vue",
    ["claude", "codex", "kimi", "opencode", "cursor"],
  ],
]);

const ROOT = new URL("..", import.meta.url);

function sourceFiles(dir) {
  const files = [];
  for (const entry of readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(ts|vue)$/.test(entry.name)) files.push(path);
  }
  return files;
}

/** Comments explain leaks, so only real code counts. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

test("shared modules do not name concrete agents", () => {
  const found = new Map();
  for (const dir of SCANNED_DIRS) {
    expect(existsSync(new URL(`${dir}/`, ROOT)), `missing scanned directory ${dir}`).toBe(true);
    for (const file of sourceFiles(dir)) {
      const source = stripComments(readFileSync(new URL(file, ROOT), "utf8"));
      const names = AGENT_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
        ({ name }) => name,
      );
      if (names.length > 0) found.set(file, names);
    }
  }

  const unexpected = [];
  for (const [file, names] of found) {
    const allowed = BASELINE.get(file) ?? [];
    for (const name of names) if (!allowed.includes(name)) unexpected.push(`${file}: ${name}`);
  }
  expect(unexpected, "agent names leaked into shared code; use the registry or catalog").toEqual(
    [],
  );

  const stale = [];
  for (const [file, names] of BASELINE) {
    const current = found.get(file) ?? [];
    for (const name of names) if (!current.includes(name)) stale.push(`${file}: ${name}`);
  }
  expect(stale, "baseline entries are gone; remove them from BASELINE").toEqual([]);
});
