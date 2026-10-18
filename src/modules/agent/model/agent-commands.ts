import { commandArgs } from "../../../common/utilities/commands.ts";
import { chatsOf, resolveChat, type ChatController } from "./chat-registry.ts";
import { registerSessionCommands } from "./session-commands.ts";
import { registerTaskCommands } from "./task-commands.ts";
import type { RewindScope } from "./types.ts";

/** How the workspace registers one of its commands (the same call as for its own). */
export type RegisterCommand = (
  id: string,
  title: string,
  run: (args?: unknown) => unknown,
  enabled: (args?: unknown) => boolean,
  requires?: undefined,
  meta?: { description?: string; arguments?: Record<string, string> },
) => unknown;

const CHAT = "Ключ чата из ide.agent.chats.list; без него — чат, с которым работали последним";
const SCOPES: RewindScope[] = ["conversation", "files", "both"];

function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || !value) throw new Error(`Укажите ${key}`);
  return value;
}

/** The newest message of the user, which `edit`, `retry` and `rewind` take when no turn is named. */
function turnArg(chat: ChatController, args: Record<string, unknown>, role: "user" | "assistant") {
  if (typeof args.turnId === "string" && args.turnId) return args.turnId;
  const turn = chat.turns().findLast((item) => item.role === role);
  if (!turn) throw new Error("В чате ещё нет сообщений");
  return turn.id;
}

/**
 * The commands of agent chats, for the workspace of a project. They live here and not in the chat
 * component because a chat is a tab that comes and goes, while the commands (and the agent that
 * reads them) must exist as long as the workspace does; each one finds the open chat when it runs.
 */
export function registerAgentCommands(register: RegisterCommand, projectId: string): void {
  registerTaskCommands(register, projectId);
  registerSessionCommands(register, projectId);
  const anyChat = () => chatsOf(projectId).length > 0;
  const external = () => chatsOf(projectId).some((chat) => chat.backend !== "projector");
  const idle = () => chatsOf(projectId).some((chat) => !chat.busy());
  const find = (args: unknown, accept?: (chat: ChatController) => boolean) =>
    resolveChat(projectId, commandArgs(args).chat, accept);
  const notProjector = (chat: ChatController) => chat.backend !== "projector";

  register(
    "ide.agent.chats.list",
    "Открытые чаты агентов",
    () =>
      chatsOf(projectId).map((chat) => ({
        chat: chat.key,
        agent: chat.label,
        busy: chat.busy(),
        messages: chat.turns().length,
      })),
    anyChat,
    undefined,
    {
      description:
        "Возвращает открытые чаты агентов проекта: ключ (аргумент chat других ide.agent.*), агент, занят ли он и число сообщений. Первым идёт чат, с которым работали последним.",
    },
  );
  register(
    "ide.agent.turns.list",
    "Сообщения чата агента",
    (args) =>
      find(args)
        .turns()
        .map((turn) => ({
          turnId: turn.id,
          role: turn.role,
          text: turn.text.trim().slice(0, 200),
          versions: (turn.variants?.length ?? 0) + (turn.role === "user" ? 1 : 0),
        })),
    anyChat,
    undefined,
    {
      description:
        "Возвращает сообщения открытого чата: идентификатор (turnId для edit, retry и rewind), роль, начало текста и число версий пользовательского сообщения.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.controls.menu.toggle",
    "Открыть или закрыть параметры агента",
    (args) => find(args, notProjector).toggleControlsMenu(),
    () => external() && idle(),
    undefined,
    {
      description:
        "Показывает остров над полем ввода: модель, усилие, режим и разрешения с пояснениями.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.controls.list",
    "Параметры агента: модель, усилие, режим",
    (args) =>
      find(args, notProjector)
        .controls()
        .map((control) => ({
          id: control.id,
          name: control.name,
          current: control.current,
          options: control.options.map((option) => option.value),
        })),
    external,
    undefined,
    {
      description:
        "Возвращает настройки открытого чата внешнего агента (модель, усилие рассуждений, режим) с текущими значениями и допустимыми вариантами.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.control.set",
    "Выбрать модель, усилие или режим агента",
    async (args) => {
      const options = commandArgs(args);
      const id = text(options, "id");
      const value = text(options, "value");
      await find(args, notProjector).setControl(id, value);
      return { id, value };
    },
    () => external() && idle(),
    undefined,
    {
      description:
        "Задаёт настройку открытого чата внешнего агента. Действует со следующего сообщения и запоминается как выбор по умолчанию для этого агента.",
      arguments: {
        id: "Идентификатор настройки из ide.agent.controls.list (например model)",
        value: "Одно из допустимых значений настройки",
        chat: CHAT,
      },
    },
  );
  register(
    "ide.agent.sessions.list",
    "Прошлые сессии агента",
    (args) => find(args, notProjector).loadSessions(),
    external,
    undefined,
    {
      description:
        "Возвращает прошлые сессии агента открытого чата в папке проекта, от новых к старым: идентификатор, название и время.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.session.resume",
    "Продолжить прошлую сессию агента",
    async (args) => {
      const sessionId = text(commandArgs(args), "sessionId");
      await find(args, notProjector).resumeSession(sessionId);
      return { sessionId };
    },
    () => external() && idle(),
    undefined,
    {
      description:
        "Заменяет содержимое открытого чата сообщениями выбранной прошлой сессии; следующее сообщение продолжит её. Идентификаторы даёт ide.agent.sessions.list.",
      arguments: { sessionId: "Идентификатор сессии", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.send",
    "Отправить сообщение агенту",
    async (args) => {
      await find(args).send(text(commandArgs(args), "text"));
    },
    anyChat,
    undefined,
    {
      description:
        "Отправляет сообщение в открытый чат агента. Если агент ещё отвечает, сообщение встаёт в очередь и уходит, когда ответ закончится.",
      arguments: { text: "Текст сообщения", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.inject",
    "Добавить сообщение в идущий ответ агента",
    async (args) => {
      const chat = find(args, (item) => item.busy() && !!item.capabilities().inject);
      const added = await chat.inject(text(commandArgs(args), "text"));
      return { added };
    },
    () => chatsOf(projectId).some((chat) => chat.busy() && !!chat.capabilities().inject),
    undefined,
    {
      description:
        "Добавляет уточнение в ответ, который агент пишет сейчас: он учтёт его, не останавливаясь. Если ответ уже закончился, сообщение остаётся в очереди (added: false).",
      arguments: { text: "Текст уточнения", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.stop",
    "Остановить ответ агента",
    (args) => find(args, (chat) => chat.busy()).stop(),
    () => chatsOf(projectId).some((chat) => chat.busy()),
    undefined,
    {
      description:
        "Останавливает ответ, который агент пишет сейчас. Сообщения в очереди после этого сами не уходят.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.edit",
    "Править сообщение и отправить заново",
    (args) => {
      const chat = find(args, (item) => !item.busy());
      chat.edit(turnArg(chat, commandArgs(args), "user"));
    },
    idle,
    undefined,
    {
      description:
        "Возвращает отправленное сообщение в поле ввода, а разговор после него убирает в другую версию (к ней можно вернуться). Без turnId берётся последнее сообщение пользователя. Файлы не меняются.",
      arguments: { turnId: "Сообщение из ide.agent.turns.list", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.retry",
    "Повторить ответ агента",
    async (args) => {
      const chat = find(args, (item) => !item.busy());
      await chat.retry(turnArg(chat, commandArgs(args), "assistant"));
    },
    idle,
    undefined,
    {
      description:
        "Задаёт агенту тот же вопрос заново; прежний ответ остаётся другой версией сообщения. Файлы не откатываются.",
      arguments: { turnId: "Сообщение или ответ из ide.agent.turns.list", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.rewind",
    "Откатить чат к сообщению",
    async (args) => {
      const options = commandArgs(args);
      const scope = (options.scope ?? "conversation") as RewindScope;
      if (!SCOPES.includes(scope)) throw new Error(`scope: ${SCOPES.join(", ")}`);
      const chat = find(args, (item) => !item.busy());
      return chat.rewind(turnArg(chat, options, "user"), scope);
    },
    idle,
    undefined,
    {
      description:
        "Возвращает чат к моменту до сообщения. scope: conversation — только разговор (сообщение уходит в поле ввода), files — файлы проекта возвращаются к тому шагу (если агент хранит резервные копии), both — и то и другое. Меняет файлы на диске: используйте по просьбе пользователя.",
      arguments: {
        turnId: "Сообщение пользователя из ide.agent.turns.list; по умолчанию последнее",
        scope: "conversation | files | both",
        chat: CHAT,
      },
    },
  );
  register(
    "ide.agent.chat.version.show",
    "Показать другую версию разговора",
    (args) => {
      const options = commandArgs(args);
      const version = Number(options.version);
      if (!Number.isInteger(version) || version < 1) throw new Error("version — номер от 1");
      find(args, (item) => !item.busy()).showVersion(text(options, "turnId"), version - 1);
    },
    idle,
    undefined,
    {
      description:
        "Переключает чат на другую версию разговора с сообщения, которое правили или повторяли.",
      arguments: {
        turnId: "Сообщение пользователя из ide.agent.turns.list",
        version: "Номер версии, с 1",
        chat: CHAT,
      },
    },
  );
  register(
    "ide.agent.chat.queue.list",
    "Сообщения в очереди агента",
    (args) => find(args).queue(),
    anyChat,
    undefined,
    {
      description: "Возвращает сообщения, которые ждут конца ответа агента.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.queue.remove",
    "Убрать сообщение из очереди агента",
    (args) => find(args).removeQueued(text(commandArgs(args), "id")),
    anyChat,
    undefined,
    {
      description: "Убирает сообщение из очереди по идентификатору из ide.agent.chat.queue.list.",
      arguments: { id: "Идентификатор из очереди", chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.export",
    "Экспортировать чат агента в Markdown",
    (args) => find(args).exportMarkdown(),
    anyChat,
    undefined,
    {
      description: "Возвращает весь открытый разговор как Markdown-документ.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.compact",
    "Сжать контекст агента",
    (args) => find(args, (chat) => !!chat.capabilities().compact && !chat.busy()).compact(),
    () => chatsOf(projectId).some((chat) => !!chat.capabilities().compact && !chat.busy()),
    undefined,
    {
      description:
        "Просит агента сжать разговор, освобождая место в окне контекста. Подходит, когда в чате показано предупреждение о заполнении контекста.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.worktree.status",
    "Изолированная копия проекта у чата",
    async (args) => (await find(args, notProjector).worktree()) ?? null,
    external,
    undefined,
    {
      description:
        "Возвращает изолированную копию проекта (git worktree), в которой работает чат: ветку и число изменённых файлов; null, если чат работает в самом проекте.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.worktree.merge",
    "Влить изолированную копию в проект",
    (args) => find(args, (chat) => notProjector(chat) && !chat.busy()).mergeWorktree(),
    idle,
    undefined,
    {
      description:
        "Коммитит изменения агента в его изолированной копии и вливает ветку копии в ветку проекта (git merge), затем удаляет копию. Меняет файлы проекта и историю git: используйте по просьбе пользователя. При конфликте слияние отменяется, проект остаётся как был.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.worktree.discard",
    "Отбросить изолированную копию проекта",
    async (args) => {
      await find(args, (chat) => notProjector(chat) && !chat.busy()).discardWorktree();
    },
    idle,
    undefined,
    {
      description:
        "Удаляет изолированную копию чата и всё, что агент в ней сделал. Необратимо: используйте по просьбе пользователя.",
      arguments: { chat: CHAT },
    },
  );
  register(
    "ide.agent.chat.isolate",
    "Начать чат в изолированной копии проекта",
    (args) => {
      const on = commandArgs(args).on !== false;
      find(
        args,
        (chat) => notProjector(chat) && !chat.busy() && chat.turns().length === 0,
      ).setIsolate(on);
      return { isolate: on };
    },
    () => chatsOf(projectId).some((chat) => notProjector(chat) && chat.turns().length === 0),
    undefined,
    {
      description:
        "Включает (on: true, по умолчанию) или выключает режим, при котором первое сообщение пустого чата запускает агента в отдельной копии проекта (git worktree на своей ветке). Так несколько агентов не мешают друг другу. Работает только в git-проекте и в чате без сообщений.",
      arguments: { on: "true или false", chat: CHAT },
    },
  );
  register(
    "ide.agent.mcp.list",
    "MCP-серверы агента",
    (args) => find(args, notProjector).mcpServers(),
    external,
    undefined,
    {
      description:
        "Возвращает MCP-серверы агента в проекте. У Claude Code это серверы из его настроек и .mcp.json (имя, состояние, число инструментов, ошибка); остальным агентам Projector передаёт stdio-серверы из .mcp.json проекта.",
      arguments: { chat: CHAT },
    },
  );
}
