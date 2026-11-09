import { onScopeDispose, ref, watch, type Ref } from "vue";
import type { EditorState } from "@codemirror/state";
import { findWorkspacePaths } from "../../../../workspace-api/index.ts";
import { chipIcon } from "../../../../agent-core/index.ts";
import type { MessageChip } from "../../../../agent-core/index.ts";

/** The word being completed: `@query` anywhere, `/query` only as the first thing written. */
export interface ComposerTrigger {
  kind: "file" | "command";
  query: string;
  from: number;
  to: number;
}

export interface ComposerSuggestion {
  key: string;
  label: string;
  detail?: string;
  /** The detail is a path: its end matters, so a long one is cut at the start. */
  path?: boolean;
  chip: MessageChip;
  icon: string;
}

export function triggerAt(state: EditorState): ComposerTrigger | undefined {
  const { main } = state.selection;
  if (!main.empty) return undefined;
  const line = state.doc.lineAt(main.head);
  const before = line.text.slice(0, main.head - line.from);
  const file = /(?:^|\s)@([^\s@"]*)$/.exec(before);
  if (file) {
    const query = file[1]!;
    return { kind: "file", query, from: main.head - query.length - 1, to: main.head };
  }
  const command = /^\/([^\s/]*)$/.exec(before);
  if (command && line.number === 1)
    return { kind: "command", query: command[1]!, from: line.from, to: main.head };
  return undefined;
}

/** File and command completion of the composer; the editor owns insertion, this owns the list. */
export function useComposerSuggestions(options: {
  projectId: () => string | undefined;
  commands: () => { name: string; description?: string }[] | undefined;
  trigger: Ref<ComposerTrigger | undefined>;
  dismissed: Ref<string>;
}) {
  const suggestions = ref<ComposerSuggestion[]>([]);
  const active = ref(0);
  let search: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function refresh() {
    const current = options.trigger.value;
    search?.abort();
    clearTimeout(timer);
    if (!current || options.dismissed.value === `${current.from}:${current.query}`) {
      suggestions.value = [];
      return;
    }
    if (current.kind === "command") {
      const query = current.query.toLowerCase();
      suggestions.value = (options.commands() ?? [])
        .map((command) => ({ command, at: command.name.toLowerCase().indexOf(query) }))
        .filter((item) => item.at >= 0)
        // Names starting with the query first, then by how early it appears.
        .sort((a, b) => a.at - b.at || a.command.name.localeCompare(b.command.name))
        .map((item) => item.command)
        .slice(0, 30)
        .map((command) => ({
          key: command.name,
          label: `/${command.name}`,
          detail: command.description,
          chip: { type: "command" as const, name: command.name },
          icon: chipIcon({ type: "command", name: command.name }),
        }));
      active.value = 0;
      return;
    }
    const projectId = options.projectId();
    if (!projectId) return;
    const controller = (search = new AbortController());
    timer = setTimeout(async () => {
      try {
        const found = await findWorkspacePaths(projectId, current.query, controller.signal);
        if (controller.signal.aborted) return;
        suggestions.value = found.map((item) => {
          const chip: MessageChip = { type: "file", path: item.path, directory: item.directory };
          return {
            key: item.path,
            label: item.path.split("/").pop() || item.path,
            detail: item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "",
            path: true,
            chip,
            icon: chipIcon(chip),
          };
        });
        active.value = 0;
      } catch {
        if (!controller.signal.aborted) suggestions.value = [];
      }
    }, 60);
  }

  watch(options.trigger, refresh, { deep: true });
  // The agent's commands are loaded asynchronously: a list that arrives mid-typing should complete.
  watch(
    options.commands,
    () => {
      if (options.trigger.value?.kind === "command") void refresh();
    },
    { deep: true },
  );
  onScopeDispose(() => {
    search?.abort();
    clearTimeout(timer);
  });

  return { suggestions, active, refresh };
}
