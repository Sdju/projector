import {
  extendPlainDialect,
  inputOf,
  shorten,
  type AcpDialect,
  type AcpTaskPatch,
  type AcpUpdate,
} from "../acp/index.ts";

const SUBAGENT_TITLES = new Set([
  "Running start_subagent",
  "Run start_subagent?",
  "Running invoke_subagent",
  "Run invoke_subagent?",
]);

interface SubagentLaunch {
  role: string;
  prompt: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Antigravity reports shell commands under `CommandLine` / `command_line` / `commandLine` / `command`. */
export function antigravityShellCommand(toolCall: Record<string, unknown>): string {
  const input = recordOf(toolCall.rawInput);
  const output = recordOf(toolCall.rawOutput);
  return (
    text(input?.CommandLine) ||
    text(input?.command_line) ||
    text(input?.commandLine) ||
    text(input?.command) ||
    text(output?.commandLine) ||
    text(output?.command_line)
  );
}

function isSubagentCall(update: AcpUpdate): boolean {
  const kind = typeof update.kind === "string" ? update.kind : undefined;
  const title = typeof update.title === "string" ? update.title : undefined;
  if ((kind !== undefined && kind !== "other") || !title || !SUBAGENT_TITLES.has(title))
    return false;
  const meta = recordOf(update._meta);
  return meta?.is_mcp_tool_call !== true;
}

function subagentLaunches(update: AcpUpdate): SubagentLaunch[] | undefined {
  const input = inputOf(update);
  if (!Array.isArray(input.Subagents) || !input.Subagents.length) return undefined;
  const launches: SubagentLaunch[] = [];
  for (const entry of input.Subagents) {
    const row = recordOf(entry);
    if (!row || typeof row.Role !== "string" || typeof row.Prompt !== "string") return undefined;
    launches.push({ role: row.Role.trim(), prompt: row.Prompt.trim() });
  }
  return launches.length ? launches : undefined;
}

function describeLaunches(launches: readonly SubagentLaunch[]): { title: string; prompt: string } {
  const [only] = launches;
  if (launches.length === 1 && only) {
    return { title: only.role || "Antigravity subagent", prompt: only.prompt };
  }
  return {
    title: launches.map((item) => item.role || "subagent").join(", "),
    prompt: launches.map((item) => `${item.role}\n${item.prompt}`).join("\n\n"),
  };
}

function nativeShellResult(update: AcpUpdate, output: string): string {
  const raw = recordOf(update.rawOutput);
  if (!raw) return output;
  const combined =
    typeof raw.combinedOutput === "string"
      ? raw.combinedOutput
      : typeof raw.combined_output === "string"
        ? raw.combined_output
        : undefined;
  const exitCode =
    typeof raw.exitCode === "number"
      ? raw.exitCode
      : typeof raw.exit_code === "number"
        ? raw.exit_code
        : undefined;
  if (combined !== undefined) {
    if (combined.trim()) return combined;
    if (exitCode !== undefined)
      return exitCode === 0 ? "Завершено без вывода" : `Код выхода ${exitCode}`;
  }
  if (!output.trim() && exitCode !== undefined) {
    return exitCode === 0 ? "Завершено без вывода" : `Код выхода ${exitCode}`;
  }
  return output;
}

/**
 * Antigravity ACP dialect: normalizes native shell command/output fields (`CommandLine`,
 * `combinedOutput`, `exitCode`) and maps `invoke_subagent` / `start_subagent` calls to tasks.
 */
export function createAntigravityDialect(): AcpDialect {
  const openSubagents = new Set<string>();

  return extendPlainDialect({
    tool(update) {
      if (update.kind === "execute") return { name: "bash" };
      if (isSubagentCall(update)) return { name: "subagent" };
      return { name: text(update.title) || text(update.kind) || "tool" };
    },
    call(update, id) {
      if (!isSubagentCall(update)) return [];
      const launches = subagentLaunches(update);
      const described = launches ? describeLaunches(launches) : undefined;
      if (openSubagents.has(id)) {
        if (!described) return [];
        return [
          { id, title: described.title, ...(described.prompt ? { prompt: described.prompt } : {}) },
        ];
      }
      openSubagents.add(id);
      return [
        {
          id,
          kind: "agent",
          title: described?.title ?? "Субагенты Antigravity",
          status: "running",
          background: false,
          ...(described?.prompt ? { prompt: described.prompt } : {}),
          tool: id,
        },
      ];
    },
    result(update, _id, output) {
      return nativeShellResult(update, output);
    },
    end(update, id, output) {
      if (!openSubagents.delete(id)) return [];
      const summary = shorten(output);
      return [
        {
          id,
          status: update.status === "failed" ? "error" : "done",
          ...(summary ? { summary } : {}),
          tool: id,
        },
      ];
    },
    finish() {
      // Native subagent tool calls do not outlive the parent turn; close any lingering batch cleanly.
      if (!openSubagents.size) return [];
      const patches: AcpTaskPatch[] = [...openSubagents].map((id) => ({ id, status: "done" }));
      openSubagents.clear();
      return patches;
    },
  });
}
