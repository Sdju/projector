import { expect, test } from "vite-plus/test";
import { existsSync, readdirSync, readFileSync } from "node:fs";

/**
 * Guard for docs/architecture.md: common modules must not name concrete agents.
 *
 * Agent-specific knowledge lives in `server/modules/agents/<agent>/**`,
 * `server/modules/agents-integration/**` and `src/modules/agents-integration/**`, which are not
 * scanned. The shared ACP runtime is scanned separately. Everything below is shared code and has
 * to work through the registry/catalog.
 */
const SCANNED_DIRS = [
  "server/modules/agent",
  "server/modules/agent-features",
  "server/modules/agents/acp",
  "server/modules/preferences",
  "server/modules/terminal",
  "core/modules/agent-features",
  "core/modules/terminal",
  "core/modules/ide",
  "core/modules/os",
  "core/modules/os-posix",
  "src/modules/agent/model",
  "src/modules/agent/lib",
  "src/modules/agent/ui",
  "src/modules/agent-features",
  "src/modules/workspace",
  "src/modules/workspace-api",
  "src/modules/app-settings",
];

/**
 * Shared agent API handlers. The list is explicit because sibling routes are integration entry
 * points that may name their agent: `claude.ts`, `codex.ts`, `cursor.ts`, `kimi.ts`, `opencode.ts`.
 */
const SCANNED_FILES = [
  "server/routes/api/agent.ts",
  "server/routes/api/agent-chats.ts",
  "server/routes/api/agent-features.ts",
  "server/routes/api/agent-hooks.ts",
  "server/routes/api/agent-jobs.ts",
  "server/routes/api/agent-mcp.ts",
  "server/routes/api/agent-memory.ts",
  "server/routes/api/agent-skills.ts",
  "server/routes/api/agent-web.ts",
  "server/routes/api/agent-worktrees.ts",
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
  const files = [];
  for (const dir of SCANNED_DIRS) {
    expect(existsSync(new URL(`${dir}/`, ROOT)), `missing scanned directory ${dir}`).toBe(true);
    files.push(...sourceFiles(dir));
  }
  for (const file of SCANNED_FILES) {
    expect(existsSync(new URL(file, ROOT)), `missing scanned file ${file}`).toBe(true);
    files.push(file);
  }

  const found = new Map();
  for (const file of files) {
    const source = stripComments(readFileSync(new URL(file, ROOT), "utf8"));
    const names = AGENT_PATTERNS.filter(({ pattern }) => pattern.test(source)).map(
      ({ name }) => name,
    );
    if (names.length > 0) found.set(file, names);
  }

  const unexpected = [];
  for (const [file, names] of found) {
    for (const name of names) unexpected.push(`${file}: ${name}`);
  }
  expect(unexpected, "agent names leaked into shared code; use the registry or catalog").toEqual(
    [],
  );
});
