import type { AcpConnection } from "./acp-client.ts";
import type {
  AgentControl,
  AgentControlCategory,
  AgentControlOption,
  AgentSelection,
} from "./controls.ts";

type Raw = Record<string, unknown>;

const CATEGORIES: Record<string, AgentControlCategory> = {
  model: "model",
  thought_level: "effort",
  mode: "mode",
};

const asText = (value: unknown) => (typeof value === "string" ? value : "");

/** ACP select options are flat or grouped (`{ group, name, options }`). */
function flattenOptions(options: unknown): AgentControlOption[] {
  if (!Array.isArray(options)) return [];
  return options.flatMap((item): AgentControlOption[] => {
    const row = (item ?? {}) as Raw;
    if (Array.isArray(row.options)) return flattenOptions(row.options);
    const value = asText(row.value);
    if (!value) return [];
    return [
      {
        value,
        name: asText(row.name) || value,
        ...(asText(row.description) ? { description: asText(row.description) } : {}),
      },
    ];
  });
}

function fromConfigOptions(list: unknown): AgentControl[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((item): AgentControl[] => {
    const row = (item ?? {}) as Raw;
    const options = flattenOptions(row.options);
    const id = asText(row.id);
    if (row.type !== "select" || !id || !options.length) return [];
    return [
      {
        id,
        category: CATEGORIES[asText(row.category)] ?? "other",
        name: asText(row.name) || id,
        ...(asText(row.description) ? { description: asText(row.description) } : {}),
        current: asText(row.currentValue),
        options,
        via: "config",
      },
    ];
  });
}

/** Older agents report `models`/`modes` instead of (or next to) `configOptions`. */
function legacyControls(result: Raw, known: AgentControl[]): AgentControl[] {
  const controls: AgentControl[] = [];
  const models = result.models as Raw | undefined;
  if (models && Array.isArray(models.availableModels) && !known.some((c) => c.category === "model"))
    controls.push({
      id: "model",
      category: "model",
      name: "Модель",
      current: asText(models.currentModelId),
      options: (models.availableModels as Raw[]).flatMap((model) =>
        asText(model.modelId)
          ? [
              {
                value: asText(model.modelId),
                name: asText(model.name) || asText(model.modelId),
                ...(asText(model.description) ? { description: asText(model.description) } : {}),
              },
            ]
          : [],
      ),
      via: "model",
    });
  const modes = result.modes as Raw | undefined;
  if (modes && Array.isArray(modes.availableModes) && !known.some((c) => c.category === "mode"))
    controls.push({
      id: "mode",
      category: "mode",
      name: "Режим",
      current: asText(modes.currentModeId),
      options: (modes.availableModes as Raw[]).flatMap((mode) =>
        asText(mode.id)
          ? [
              {
                value: asText(mode.id),
                name: asText(mode.name) || asText(mode.id),
                ...(asText(mode.description) ? { description: asText(mode.description) } : {}),
              },
            ]
          : [],
      ),
      via: "mode",
    });
  return controls.filter((control) => control.options.length);
}

const ORDER: AgentControlCategory[] = ["model", "effort", "mode", "other"];

/** The controls of a `session/new` or `session/load` response, model first, then effort. */
export function controlsFromSession(result: unknown): AgentControl[] {
  const row = (result ?? {}) as Raw;
  const config = fromConfigOptions(row.configOptions);
  return sorted([...config, ...legacyControls(row, config)]);
}

function sorted(controls: AgentControl[]): AgentControl[] {
  return ORDER.flatMap((category) => controls.filter((control) => control.category === category));
}

/**
 * Applies the user's choices to a fresh session. Changing the model can change the options of
 * the others (Codex's effort levels depend on the model), so the controls are re-read from every
 * `set_config_option` answer. A refused value is skipped: the turn still runs with the agent's own.
 */
export async function applySelection(
  connection: AcpConnection,
  sessionId: string,
  controls: AgentControl[],
  selection: AgentSelection,
): Promise<AgentControl[]> {
  let current = controls;
  for (const category of ORDER) {
    for (const control of controls.filter((item) => item.category === category)) {
      const wanted = selection[control.id];
      const live = current.find((item) => item.id === control.id);
      if (!wanted || !live || wanted === live.current) continue;
      if (!live.options.some((option) => option.value === wanted)) continue;
      try {
        if (live.via === "config") {
          const answer = (await connection.request("session/set_config_option", {
            sessionId,
            configId: live.id,
            value: wanted,
          })) as Raw | undefined;
          const updated = fromConfigOptions(answer?.configOptions);
          if (updated.length)
            current = sorted([...updated, ...current.filter((item) => item.via !== "config")]);
          else current = withCurrent(current, live.id, wanted);
        } else {
          await connection.request(
            live.via === "model" ? "session/set_model" : "session/set_mode",
            {
              sessionId,
              ...(live.via === "model" ? { modelId: wanted } : { modeId: wanted }),
            },
          );
          current = withCurrent(current, live.id, wanted);
        }
      } catch {
        /* The agent refused this value; keep its own. */
      }
    }
  }
  return current;
}

function withCurrent(controls: AgentControl[], id: string, value: string): AgentControl[] {
  return controls.map((control) => (control.id === id ? { ...control, current: value } : control));
}
