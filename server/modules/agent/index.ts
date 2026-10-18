// The generic core of the chat agents: the backend contract, the registry the backends join, the
// runs that outlive a request, the bridges that ask the user, and the chat history. Nothing here
// names a concrete agent; each agent module (`../acp`, `../claude-code`, ...) registers itself.
export {
  registerAgentBackend,
  isAgentBackend,
  resolveAgentBackend,
  isHostedAgent,
} from "./registry.ts";
export {
  agentCapabilities,
  agentCommands,
  agentControls,
  agentMcpServers,
  agentSessions,
  loadAgentSession,
  rewindAgentFiles,
  runAgent,
  updateAgentSession,
  deleteAgentSession,
} from "./registry.ts";
export type {
  AgentBackend,
  AgentBackendId,
  AgentCapabilities,
  AgentCommand,
  AgentEmitter,
  AgentEventName,
  AgentPermissionMode,
  AgentRunHandle,
  AgentRunOptions,
  McpServerInfo,
  MessagePart,
  RewindResult,
} from "./backend.ts";
export { selectionFrom, SESSION_LIST_LIMIT } from "./controls.ts";
export type {
  AgentControl,
  AgentControlCategory,
  AgentControlOption,
  AgentSelection,
  AgentSessionInfo,
  AgentSessionPart,
  AgentSessionTurn,
} from "./controls.ts";
export { createReplay } from "./replay.ts";
export { injectMessage, registerInjector } from "./injection.ts";
export { agentEnv, assertHostProject, attachedImages, promptWithHistory } from "./agent-host.ts";
export { attachHosted, startHosted } from "./hosted-process.ts";
export {
  cancelRun,
  createRun,
  pruneRuns,
  readRun,
  removeRun,
  rememberHost,
  runDirectory,
  schedulePrune,
  stopRun,
  trackRun,
  type AgentRunRecord,
} from "./agent-runs.ts";
export {
  completeCommandRequest,
  createApprovalBridge,
  createCommandBridge,
  createQuestionBridge,
  createSecretBridge,
  relayRequest,
  unrelayRequests,
  type AgentQuestion,
  type ApprovalAnswer,
  type ApprovalRequest,
  type CommandRequest,
  type QuestionAnswer,
  type QuestionRequest,
  type SecretDestination,
  type SecretRequest,
} from "./command-bridge.ts";
export { readAttachment, saveAttachment } from "./attachments.ts";
export { readAgentHistory, writeAgentHistory } from "./history.ts";
export { closeHistoryStore } from "./history-store.ts";
export {
  archiveLiveChat,
  listArchivedChats,
  openArchivedChat,
  removeArchivedChat,
  renameArchivedChat,
} from "./chat-archive.ts";
export {
  createWorktree,
  mergeWorktree,
  removeWorktree,
  worktreeCwd,
  worktreeStatus,
  type AgentWorktree,
} from "./worktrees.ts";
