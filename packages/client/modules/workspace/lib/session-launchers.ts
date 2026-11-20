import { computed, inject, provide, ref, type InjectionKey, type Ref } from "vue";
import { agentUsageSummary } from "../../agents-integration/status-bar/index.ts";
import { builtinAgent, guiAgents, guiCommand, hasGui, useAgentModes } from "../../agent/index.ts";

/** What a launcher row remembers as «last»: a terminal program or the built-in agent chat. */
export const BUILTIN_LAUNCHER = "builtin";

const lastKey: InjectionKey<Ref<string>> = Symbol.for("projector.last-session");

/** The workspace owns the choice (it travels with the session); launchers only read and set it. */
export const provideLastSession = (last: Ref<string>) => provide(lastKey, last);

export interface SessionRow {
  program: string;
  title: string;
  caption: string;
  /** Shared icon name; the menus render it through the icon service. */
  icon: string;
  usage?: { remaining: number; tone?: "spare" | "normal" | "hot" | "over" | null };
}

export interface SessionLaunchersOptions {
  /** The chat view needs the agent feature; without it the terminal is the only option. */
  agent: () => boolean | undefined;
  busy: () => boolean;
  command: (id: string, args?: unknown) => void;
}

/**
 * The catalog of things a session can start: Shell, external agents (terminal or chat) and the
 * built-in agent. The «+» island, the header split button and the empty-group tiles share it, so
 * they offer the same programs, run the same IDE commands and agree on the last choice.
 */
export function useSessionLaunchers(options: SessionLaunchersOptions) {
  const { modeOf, setMode, isEnabled } = useAgentModes();
  const last = inject(lastKey, ref("shell"));
  const builtin = builtinAgent();
  const canOpenChat = (program: string) => !!options.agent() && hasGui(program);
  const isChat = (program: string) => canOpenChat(program) && modeOf(program) === "gui";
  /** The IDE command a program runs; the buttons expose it as `data-command`. */
  const commandOf = (program: string) =>
    isChat(program) ? guiCommand(program) : "ide.workbench.terminal.new";

  const rows = computed<SessionRow[]>(() =>
    [
      {
        program: "shell",
        title: "Shell",
        caption: "Пустой терминал в папке проекта",
        icon: "terminal",
      },
      ...guiAgents().map((agent) => ({
        program: agent.program,
        title: agent.title,
        caption: agent.caption,
        icon: agent.icon,
      })),
    ]
      .filter((entry) => entry.program === "shell" || isEnabled(entry.program))
      .map((entry) => {
        const usage = agentUsageSummary[entry.program];
        return { ...entry, usage: usage?.remaining == null ? undefined : usage } as SessionRow;
      }),
  );

  function launch(program: string) {
    if (options.busy()) return;
    last.value = program;
    if (isChat(program)) options.command(guiCommand(program));
    else options.command("ide.workbench.terminal.new", { program });
  }
  function openBuiltin() {
    last.value = BUILTIN_LAUNCHER;
    options.command("ide.workbench.agent.open");
  }

  /** The program the primary button repeats; falls back to Shell when the last one is gone. */
  const primary = computed(() => {
    if (last.value === BUILTIN_LAUNCHER && options.agent() && builtin)
      return {
        program: BUILTIN_LAUNCHER,
        title: builtin.title,
        icon: builtin.icon,
        command: "ide.workbench.agent.open",
      };
    const row = rows.value.find((entry) => entry.program === last.value) ?? rows.value[0]!;
    return {
      program: row.program,
      title: row.title,
      icon: row.icon,
      command: commandOf(row.program),
    };
  });
  function launchPrimary() {
    if (primary.value.program === BUILTIN_LAUNCHER) openBuiltin();
    else launch(primary.value.program);
  }

  return {
    rows,
    builtin: computed(() => (options.agent() ? builtin : undefined)),
    last,
    primary,
    modeOf,
    setMode,
    isEnabled,
    canOpenChat,
    isChat,
    commandOf,
    launch,
    launchPrimary,
    openBuiltin,
    toggleMode: (program: string) => setMode(program, modeOf(program) === "gui" ? "tui" : "gui"),
  };
}
