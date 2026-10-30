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
 * No baseline: common modules must not name agents at all. Any name found in shared code is a
 * leak that has to be fixed through the registry or the client catalog, never allowlisted.
 */
const BASELINE = new Map();

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
