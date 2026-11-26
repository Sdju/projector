import { computed, toValue, type MaybeRefOrGetter, type Ref } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import type { AgentTurn } from "../../agent-core/index.ts";

import { useChatScroll } from "./chat-scroll.ts";
import { useChatWindow } from "./chat-window.ts";

export function useChatViewport({
  projectId,
  chatKey,
  turns,
  loading,
  viewed,
  log,
  root,
  requestCounts,
  focusComposer,
}: {
  projectId: MaybeRefOrGetter<string>;
  chatKey: string;
  turns: Ref<AgentTurn[]>;
  loading: Readonly<Ref<boolean>>;
  viewed: MaybeRefOrGetter<boolean>;
  log: Readonly<Ref<HTMLElement | undefined>>;
  root: Readonly<Ref<HTMLElement | undefined>>;
  requestCounts: MaybeRefOrGetter<readonly number[]>;
  focusComposer: () => void;
}) {
  let rememberScroll = () => {};
  const { PRELOAD_PX, firstShown, shown, hidden, loadEarlier, topUp, reveal } = useChatWindow(
    turns,
    log,
    () => rememberScroll(),
    loading,
  );
  let tabShown = false;
  const {
    away,
    trackScroll,
    toBottom,
    rememberScroll: rememberChatScroll,
  } = useChatScroll({
    turns,
    log,
    topUp,
    preloadPx: PRELOAD_PX,
    watchSource: () => [
      turns.value.length,
      turns.value.at(-1)?.text,
      ...toValue(requestCounts),
      turns.value
        .at(-1)
        ?.tools.map((tool) => `${tool.id}:${tool.status}:${tool.detail}`)
        .join("|"),
    ],
    onShown: () => {
      const nowShown = !!root.value && root.value.getClientRects().length > 0;
      if (nowShown && !tabShown) focusComposer();
      tabShown = nowShown;
    },
  });
  rememberScroll = rememberChatScroll;
  const navigation = useCommandScope(`chat-navigation:${chatKey}`, () => ({
    surface: "agent-chat",
    project: toValue(projectId),
    chat: chatKey,
  }));
  const showTimeline = computed(
    () =>
      !loading.value &&
      !toValue(viewed) &&
      turns.value.filter((turn) => turn.role === "assistant").length >= 3,
  );
  async function goToRequest(id: string) {
    const wasAway = away.value;
    away.value = true;
    if (!(await reveal(id))) {
      away.value = wasAway;
      throw new Error("Запрос не найден");
    }
    const element = log.value?.querySelector<HTMLElement>(`[data-request-id="${CSS.escape(id)}"]`);
    if (!element || !log.value) return;
    log.value.scrollTo({
      top:
        log.value.scrollTop +
        element.getBoundingClientRect().top -
        log.value.getBoundingClientRect().top -
        12,
      behavior: "instant",
    });
    rememberScroll();
  }
  navigation.scope.registerCommand({
    id: "ide.agent.chat.request.go",
    title: "Перейти к запросу в чате",
    description:
      "Прокручивает открытый чат к указанному сообщению пользователя, подгружая раннюю историю при необходимости.",
    arguments: { turnId: "Идентификатор запроса из ide.agent.turns.list" },
    run: (value) => {
      const { turnId } = commandArgs(value);
      if (typeof turnId !== "string") throw new Error("Укажите turnId запроса");
      return goToRequest(turnId);
    },
  });
  return {
    navigation,
    showTimeline,
    firstShown,
    shown,
    hidden,
    loadEarlier,
    away,
    trackScroll,
    toBottom,
  };
}
