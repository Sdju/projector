export {
  createWorktree,
  mergeWorktree,
  removeWorktree,
  worktreeCwd,
  worktreeStatus,
  type AgentWorktree,
} from "./worktrees.ts";
export { injectMessage } from "./claude-code-input.ts";
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
  createCommandBridge,
  createApprovalBridge,
  createQuestionBridge,
  completeCommandRequest,
} from "./command-bridge.ts";
export {
  cancelRun,
  createRun,
  pruneRuns,
  readRun,
  removeRun,
  schedulePrune,
  trackRun,
  type AgentRunRecord,
} from "./agent-runs.ts";
export {
  AGENT_BACKEND_IDS,
  HOSTED_AGENT_BACKENDS,
  AGENT_PERMISSION_MODES,
  agentCommands,
  agentControls,
  agentCapabilities,
  agentMcpServers,
  agentSessions,
  rewindAgentFiles,
  updateAgentSession,
  loadAgentSession,
  runAgent,
  selectionFrom,
} from "./agent.ts";
export type {
  AgentControl,
  AgentSessionInfo,
  AgentSessionTurn,
  McpServerInfo,
  MessagePart,
  RewindResult,
} from "./agent.ts";
