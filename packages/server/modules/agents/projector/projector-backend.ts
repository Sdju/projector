import { runHostedAgent, type AgentBackend, type AgentRunOptions } from "../../agent/index.ts";
import { fileURLToPath } from "node:url";
import { defaultSettingsMiddleware, wrapLanguageModel, type ModelMessage } from "ai";
import type { Project } from "../../projects/index.ts";
import { createAgentTools } from "./agent-tools.ts";
import { taskRunnerFor } from "./projector-task.ts";
import { createSideTools, SIDE_LIMITS, sideAbort, sideSystem } from "./projector-side.ts";
import { projectorSystem } from "./projector-system.ts";
import { featureEnabled } from "../../agent-features/index.ts";
import {
  createQwenOpenAI,
  envFallbackFromProcess,
  quietThinkingBody,
  resolveOpenAIProvider,
} from "../../providers/index.ts";
import { contextOf, costOf, taskSpendRecorder, tokensOf } from "./projector-usage.ts";
import { createTurnInput } from "./projector-input.ts";
import { budgetNote, turnBudget } from "./projector-budget.ts";
import { streamProjectorAnswer } from "./projector-answer.ts";
import { connectMcp, type McpConnection } from "./projector-mcp.ts";
import { expandSlash, listSkills, skillsForRole } from "./projector-skills.ts";
import { loadHooks, runStopHooks, withHooks } from "./projector-hooks.ts";
import { createBashReviewer } from "./projector-review.ts";
import { controls, THINKING, TRUST } from "./projector-controls.ts";
import { toMessages, userMessage } from "./projector-history.ts";
import {
  COMPACT_COMMAND,
  compactChat,
  compactHistory,
  splitAtCompaction,
} from "./projector-compaction.ts";
import { trustedProjectWidgets } from "../../project-widgets/index.ts";

/** The window of a model that has none registered in the provider settings; the context ring is measured against it. */
const DEFAULT_CONTEXT_SIZE = Number(process.env.PROJECTOR_AGENT_CONTEXT_TOKENS) || 128_000;

/** The runner process of a hosted answer (the composition root, which also registers the widgets). */
const RUNNER = fileURLToPath(new URL("../../../app/projector-runner.ts", import.meta.url));

/** The run: held by its own process when the route gave it one, otherwise in this process. */
async function run(options: AgentRunOptions): Promise<void> {
  if (!options.run) return runProjector(options);
  // The runner reads the provider keys itself, so it gets the server's environment; the shell
  // tool drops anything that looks like a secret before it starts a command.
  await runHostedAgent(
    options,
    options.run,
    {
      runner: RUNNER,
      cwd: options.cwd || process.cwd(),
      env: { ...process.env },
    },
    options.messageId,
  );
}

/** MCP servers live for one turn: whatever the turn started is stopped however it ends. */
export async function runProjector(options: AgentRunOptions): Promise<void> {
  const effective = options.side ? { ...options, abort: sideAbort(options.abort) } : options;
  const open = { close: async () => {} };
  const input = createTurnInput(effective);
  try {
    await turn(effective, open, input);
  } finally {
    input.close();
    await open.close();
  }
}
async function turn(
  options: AgentRunOptions,
  open: { close: () => Promise<void> },
  input: ReturnType<typeof createTurnInput>,
): Promise<void> {
  const side = options.side === true;
  const [providerId, ...rest] = (options.selection?.provider || options.providerId || "").split(
    ":",
  );
  const resolved = await resolveOpenAIProvider({
    providerId,
    model: rest.join(":"),
    fallback: envFallbackFromProcess(),
  });
  const provider = createQwenOpenAI({
    openaiUrl: resolved.url,
    openaiApiKey: resolved.apiKey,
  });
  const model = provider.chatModel(resolved.model);
  const style = resolved.thinking === false ? "none" : resolved.thinkingStyle;
  // The side requests (summary, command review) never think; the answer itself follows the chat's choice.
  const quiet = quietThinkingBody(style);
  const quietModel = quiet
    ? wrapLanguageModel({
        model,
        middleware: defaultSettingsMiddleware({
          settings: { providerOptions: { qwenOpenai: quiet } },
        }),
      })
    : model;
  const charge = (task: string) =>
    taskSpendRecorder(task, resolved.price, resolved.id, resolved.modelName);
  const mode = options.selection?.[TRUST] ?? options.permissionMode;
  const added: Project[] = [];
  const review =
    mode === "auto"
      ? createBashReviewer(quietModel, options.cwd, options.abort, charge("review"))
      : undefined;
  const guard = {
    cwd: options.cwd,
    approve: options.approve,
    trusting: mode === "bypassPermissions",
    review,
  };
  const skills = side ? [] : skillsForRole(await listSkills(options.cwd), options.role?.skills);
  const projectWidgets =
    side || !(await featureEnabled("projector", "widgets", options.features))
      ? []
      : await trustedProjectWidgets(options.projectId);
  const own = side
    ? createSideTools({
        commands: options.commands,
        chat: options.chat,
        scope: options.scope,
      })
    : createAgentTools({
        cwd: options.cwd,
        projectId: options.projectId,
        commands: options.commands,
        signal: options.abort,
        ask: options.ask,
        secret: options.secret,
        guard,
        skills,
        runTask: taskRunnerFor({
          cwd: options.cwd,
          projectId: options.projectId,
          selection: options.selection,
          role: options.role,
          signal: options.abort,
          emit: options.emit,
        }),
        onOutput: (id, chunk) => options.emit("tool-output", { id, chunk }),
        onProject: (project) => {
          added.push(project);
          options.emit("project", project);
        },
      });

  const earlier = splitAtCompaction(options.history ?? []);
  if (!side && options.message.trim() === COMPACT_COMMAND) {
    await compactChat(
      quietModel,
      earlier,
      options,
      resolved,
      DEFAULT_CONTEXT_SIZE,
      charge("compaction"),
    );
    return;
  }
  const { recent, summary } = side
    ? { recent: earlier.turns, summary: earlier.summary }
    : await compactHistory(quietModel, earlier.turns, {
        signal: options.abort,
        base: earlier.summary,
        onStart: () => options.emit("status", { phase: "compacting" }),
        onUsage: charge("compaction"),
      });
  const mcp: McpConnection = side
    ? { tools: {}, problems: [], servers: [], close: async () => {} }
    : await connectMcp(options.cwd, guard, options.abort, options.role?.mcp);
  open.close = mcp.close;
  const hooks = side ? [] : await loadHooks(options.cwd, guard);
  const started = Date.now();
  const tools = side
    ? own
    : (withHooks({ ...mcp.tools, ...own }, hooks, options.cwd) as typeof own);
  const messages: ModelMessage[] = toMessages(recent);
  const sideMessage = await userMessage(
    side ? options.message : expandSlash(options.message, skills),
    options.parts,
  );
  const previous = messages.at(-1);
  if (
    side &&
    previous?.role === "user" &&
    typeof previous.content === "string" &&
    typeof sideMessage.content === "string"
  ) {
    messages[messages.length - 1] = {
      role: "user",
      content: `${previous.content}\n\n[Отдельный вопрос в сторону, не часть основного задания]\n${sideMessage.content}`,
    };
  } else messages.push(sideMessage);

  options.emit("status", {
    phase: "thinking",
    provider: resolved.name,
    model: resolved.model,
  });
  if (!side) options.emit("controls", { controls: await controls(options.selection ?? {}) });

  const system = side
    ? sideSystem(options.cwd, summary)
    : await projectorSystem(options, {
        projectWidgets,
        skills,
        mcp,
        summary,
      });
  const budget = turnBudget(side ? SIDE_LIMITS : undefined);
  const wanted = options.selection?.[THINKING];
  const answer = await streamProjectorAnswer({
    model,
    fallbackModel: (id) => provider.chatModel(id),
    resolved,
    style,
    wanted,
    system,
    messages,
    tools,
    input,
    budget,
    options,
  });
  if (!answer) return;
  let { text } = answer;
  const { requests, firstRequest, price } = answer;

  input.close();
  try {
    // Providers that cache the prompt prefix report it; the chat shows the share served from cache.
    const total = requests.map(tokensOf).reduce(
      (sum, item) => ({
        input: sum.input + item.input,
        output: sum.output + item.output,
        cacheRead: sum.cacheRead + item.cacheRead,
        cacheWrite: sum.cacheWrite + item.cacheWrite,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    );
    if (total.input + total.cacheRead + total.cacheWrite + total.output)
      options.emit("usage", {
        ...total,
        first: firstRequest,
        ...(price ? { cost: costOf(total, price) } : {}),
      });
  } catch {
    // No usage, no tooltip.
  }
  // Each step resends the conversation, so summing their input usage
  // counts the same prefix again. The last request is the window.
  const used = contextOf(requests);
  if (used)
    options.emit("context", {
      used,
      size: resolved.contextTokens ?? DEFAULT_CONTEXT_SIZE,
      model: resolved.model,
    });
  const stopped = budget.reason();
  if (stopped) {
    const note = budgetNote(budget.reason(), side ? SIDE_LIMITS : undefined);
    text += note;
    options.emit("text", { text: note });
  }

  options.emit("done", {
    text: text.trim(),
    added: added.map((item) => item.id),
    stopped,
  });
  if (!side)
    await runStopHooks(hooks, options.cwd, { seconds: (Date.now() - started) / 1000, text });
}

/** The Projector IDE assistant on the active OpenAI-compatible provider. */
export const projectorBackend: AgentBackend = {
  id: "projector",
  label: "Projector",
  builtin: true,
  capabilities: {
    hosted: true,
    inject: true,
    compact: { command: COMPACT_COMMAND, hintAt: 0.8, autoAt: 0.9 },
  },
  controls: () => controls(),
  commands: async (cwd) => [
    { name: COMPACT_COMMAND.slice(1), description: "Сжать историю разговора в сводку" },
    ...(await listSkills(cwd || undefined)).map((item) => ({
      name: item.name,
      description: item.description,
      hint: item.hint,
    })),
  ],
  run,
};
