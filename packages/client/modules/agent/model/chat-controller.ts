import {
  chatControlsGroup,
  chatFlowGroup,
  chatHistoryGroup,
  chatQueueGroup,
  chatRefGroup,
  chatSessionsGroup,
  type AgentBackendId,
  type AgentChat,
  type ChatBranch,
  type ChatController,
  type RewindScope,
  type RewindSummary,
} from "../../agent-core/index.ts";
import { lensActions, useAgentLens } from "../../agent-turns/index.ts";
import { exportChat } from "../lib/export.ts";
import {
  chatComposerGroup,
  type ChatComposerHandle,
  type ChatControlsHandle,
} from "../modules/composer/index.ts";
import {
  chatMcpGroup,
  chatSideGroup,
  chatWorktreeGroup,
  type SideQuestion,
} from "../modules/panels/index.ts";

/**
 * What the chat publishes to the workspace commands, assembled from the groups its modules own:
 * the chat state (`agent-core`), the composer, the panels and Lens. A new capability adds its own
 * group here instead of growing the interface every command depends on.
 */
export interface ChatControllerOptions {
  projectId: string;
  backend: AgentBackendId;
  label: string;
  /** The chat state and actions of this tab. */
  chat: AgentChat;
  /** The chat is on screen: its tab is the shown one. */
  visible: () => boolean;
  composer: () => ChatComposerHandle | undefined;
  controls: () => ChatControlsHandle | undefined;
  pendingForm: () => string | undefined;
  fork: ChatBranch["fork"];
  compact: () => Promise<void>;
  rewindTo: (turnId: string, scope: RewindScope) => Promise<RewindSummary | undefined>;
  lens: ReturnType<typeof useAgentLens>;
  side: SideQuestion;
}

export function createChatController(options: ChatControllerOptions): ChatController {
  const { chat } = options;
  return {
    ...chatRefGroup(chat, options),
    ...chatControlsGroup(chat),
    ...chatFlowGroup(chat, options),
    ...chatHistoryGroup(chat, {
      exportMarkdown: () => exportChat(chat.turns.value, options.label),
      rewindTo: options.rewindTo,
    }),
    ...chatQueueGroup(chat),
    ...chatSessionsGroup(chat),
    ...chatComposerGroup(options.composer, options.controls, options.pendingForm),
    ...chatSideGroup(options.side),
    ...lensActions(options.lens),
    ...chatMcpGroup(options.backend, options.projectId),
    ...chatWorktreeGroup(chat),
  };
}
