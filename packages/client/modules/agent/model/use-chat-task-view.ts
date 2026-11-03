import { computed, ref, watch, type Ref } from "vue";
import { barTasks, chatTasks, taskDetail } from "../lib/task-detail.ts";
import type { AgentTask, AgentTurn } from "./types.ts";

/**
 * The subagent/background-command strip of a chat and the task shown in place of the log. The
 * task can also be opened in its own tab through the workspace command.
 */
export function useChatTaskView(options: {
  turns: Ref<AgentTurn[]>;
  openTab: (task: AgentTask | undefined, id: string) => void;
}) {
  const tasks = computed(() => barTasks(options.turns.value));
  const viewing = ref("");
  const viewed = computed(() =>
    viewing.value ? taskDetail(options.turns.value, viewing.value) : undefined,
  );
  watch(
    () => !!viewing.value && !viewed.value,
    (gone) => {
      if (gone) viewing.value = "";
    },
  );
  function view(id: string) {
    viewing.value = viewing.value === id ? "" : id;
  }
  function open(id: string) {
    options.openTab(
      chatTasks(options.turns.value).find((item) => item.id === id),
      id,
    );
  }
  return { tasks, viewing, viewed, view, open };
}
