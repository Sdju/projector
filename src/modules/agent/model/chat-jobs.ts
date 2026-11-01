import { computed, reactive } from "vue";
import { useJobChat } from "./job-chat.ts";
import type { AgentPermission, AgentQuestionRequest, AgentSecretRequest } from "./types.ts";

interface Options {
  projectId: string;
  chat: string;
  enabled: () => boolean;
  send: (text: string, options?: { auto?: string }) => Promise<void>;
  permissions: { readonly value: AgentPermission[] };
  questions: { readonly value: AgentQuestionRequest[] };
  secrets: { readonly value: AgentSecretRequest[] };
}

/** The jobs of this Projector chat together with the requests they are waiting for. */
export function useChatJobs(options: Options) {
  const { jobs, refresh, open } = useJobChat(options.projectId, {
    enabled: options.enabled,
    chat: options.chat,
    send: options.send,
  });
  const hasRequests = computed(
    () =>
      options.permissions.value.length > 0 ||
      options.questions.value.length > 0 ||
      options.secrets.value.length > 0 ||
      (options.enabled() && jobs.value.some((job) => job.pending.length > 0)),
  );
  return reactive({ jobs, refresh, open, hasRequests });
}
