import type { Ref } from "vue";
import type {
  AgentRole,
  AgentRoleSelection,
  AgentRoleView,
} from "@ai-projector/core/modules/agent-role/index.ts";
import { commandArgs, type CommandScope } from "../../../common/utilities/commands.ts";
import type { ListenerState } from "../api/roles.ts";
import type { AgentRoleSettings } from "../api/roles.ts";

export interface RoleSettingsCommands {
  scope: CommandScope;
}

/** What the role settings know: the catalog, drafts and the save/reset actions behind them. */
export interface RoleSettingsCommandsOptions {
  commands: RoleSettingsCommands;
  busy: Ref<string>;
  chatRoles: Ref<AgentRoleView[]>;
  listener: Ref<ListenerState | null>;
  loadRoles: () => Promise<AgentRoleSettings>;
  loadListener: () => Promise<unknown>;
  setService: (role: string, provider: string, prompt?: string) => Promise<unknown>;
  resetService: (role: string) => Promise<unknown>;
  createChat: () => Promise<unknown>;
  saveChat: (id: string, role: Partial<AgentRole>) => Promise<unknown>;
  removeChat: (id: string) => Promise<unknown>;
}

/** The `ide.agent.roles.*` commands of the settings page, hidden from the palette like the rest. */
export function registerRoleSettingsCommands(options: RoleSettingsCommandsOptions): void {
  const { commands, busy, chatRoles, listener } = options;
  commands.scope.registerCommand({
    id: "ide.agent.roles.list",
    palette: false,
    title: "Список ролей агентов",
    description:
      "Возвращает служебные роли (Доктор, Lens, Судья, Listener) и chat-роли: id, название, агента, выбранные настройки и наследуется ли модель. У media-роли (Listener) поле media говорит, какие модели она берёт, а prompt — контекст распознавания. Служебные роли — внутренние вызовы без инструментов; chat-роль открывает обычный чат.",
    run: async () => {
      const data = await options.loadRoles();
      if (data.roles.some((role) => role.media) && !listener.value)
        await options.loadListener().catch(() => undefined);
      return {
        file: data.file,
        roles: data.roles.map((role) => ({
          id: role.id,
          name: role.name,
          description: role.description,
          kind: role.kind,
          agent: role.agent,
          selection: role.selection,
          media: role.media,
          prompt: role.prompt,
          template: role.template,
          skills: role.skills,
          mcp: role.mcp,
          inherited: role.inherited,
        })),
        listener: listener.value,
      };
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.set",
    palette: false,
    title: "Выбрать модель служебной роли",
    description:
      "Задаёт модель для служебной роли Projector. provider — значение из ide.agent.roles.list, например provider:model; пустая строка возвращает роль к модели чата, а Listener — к первой доступной модели распознавания. prompt задаёт контекст media-роли (имена и термины для Listener); у остальных служебных ролей он игнорируется, их промпты фиксированы. Смена модели не трогает промпты, отсутствие инструментов и лимиты.",
    arguments: {
      role: "string: id служебной роли: doctor, lens, judge или listener",
      provider: "string: provider:model из настроек провайдеров; пустая строка — автоматически",
      prompt: "string: контекст распознавания для listener (необязательно)",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role)
        throw new Error("role: id служебной роли: doctor, lens, judge или listener");
      if (typeof args.provider !== "string")
        throw new Error("provider: строка provider:model или пустая строка");
      const prompt = typeof args.prompt === "string" ? args.prompt : undefined;
      return options.setService(args.role, args.provider, prompt);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.reset",
    palette: false,
    title: "Сбросить модель служебной роли",
    description:
      "Удаляет выбранную модель и контекст роли. Доктор, Lens и Судья снова используют модель текущего чата или активного провайдера, Listener — первую доступную модель распознавания.",
    arguments: { role: "string: id служебной роли: doctor, lens, judge или listener" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role)
        throw new Error("role: id служебной роли: doctor, lens, judge или listener");
      return options.resetService(args.role);
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.create",
    palette: false,
    title: "Создать chat-роль",
    description:
      "Создаёт новую роль для чата с именем «Новая роль» и агентом Projector. Дальше её настройки меняет ide.agent.roles.save: название, агент и набор controls. Возвращает созданную роль.",
    run: () => options.createChat(),
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.save",
    palette: false,
    title: "Сохранить chat-роль",
    description:
      "Меняет название, описание, агента, выбранные настройки, промпт, шаблон контекста, навыки и MCP chat-роли. selection — объект control id → value; отсутствующее значение наследует умолчание агента. prompt добавляется к системному промпту; template: true превращает его в шаблон с {system}, {features}, {widgets}, {project}, {memory}, {skills}, {mcp}, {role} и {summary}. skills и mcp — имена, пустой массив выключает их. Не переданные поля сохраняются. Роль действует на новые чаты; уже начатые чаты сохраняют снимок.",
    arguments: {
      role: "string: id chat-роли",
      name: "string: название роли",
      agent: "string: id агента из каталога",
      description: "string: описание (необязательно)",
      selection: "object: control id → value (необязательно)",
      prompt: "string: дополнительные инструкции роли (необязательно)",
      template: "boolean: промпт роли — шаблон контекста (необязательно)",
      skills: "array: имена навыков; пустой массив выключает (необязательно)",
      mcp: "array: имена MCP-серверов; пустой массив выключает (необязательно)",
    },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id chat-роли");
      if (typeof args.name !== "string" || !args.name.trim())
        throw new Error("name: название роли");
      if (typeof args.agent !== "string" || !args.agent) throw new Error("agent: id агента");
      const known = chatRoles.value.find((role) => role.id === args.role);
      if (!known) throw new Error(`Неизвестная chat-роль: ${args.role}`);
      const selection =
        args.selection && typeof args.selection === "object" && !Array.isArray(args.selection)
          ? (args.selection as AgentRoleSelection)
          : known.selection;
      const names = (input: unknown, fallback: string[] | undefined) =>
        Array.isArray(input)
          ? input.filter((item): item is string => typeof item === "string")
          : fallback;
      return options.saveChat(args.role, {
        ...known,
        name: args.name,
        agent: args.agent,
        description: typeof args.description === "string" ? args.description : known.description,
        selection,
        prompt: typeof args.prompt === "string" ? args.prompt : known.prompt,
        template: typeof args.template === "boolean" ? args.template : known.template,
        skills: names(args.skills, known.skills),
        mcp: names(args.mcp, known.mcp),
      });
    },
  });
  commands.scope.registerCommand({
    id: "ide.agent.roles.delete",
    palette: false,
    title: "Удалить chat-роль",
    description:
      "Удаляет chat-роль. Уже начатые чаты продолжают работать со своим снимком; роль перестаёт появляться в меню новой сессии.",
    arguments: { role: "string: id chat-роли" },
    enabled: () => !busy.value,
    run: (value) => {
      const args = commandArgs(value);
      if (typeof args.role !== "string" || !args.role) throw new Error("role: id chat-роли");
      return options.removeChat(args.role);
    },
  });
}
