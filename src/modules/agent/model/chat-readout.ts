import { readoutLines, useTabReadout } from "../../../common/utilities/tab-readout.ts";
import type { Ref } from "vue";
import type { AgentBackendId, AgentControl, AgentTurn } from "./types.ts";

/** What the built-in agent sees when it reads the chat's tab: status, last answer and tool chips. */
export function useChatReadout(chat: {
  backend: AgentBackendId;
  agent: string;
  busy: Ref<boolean>;
  phase: Ref<string>;
  error: Ref<string>;
  controls: Ref<AgentControl[]>;
  turns: Ref<AgentTurn[]>;
}): void {
  useTabReadout(() => {
    const last = chat.turns.value.at(-1);
    const answer = chat.turns.value
      .findLast((turn) => turn.role === "assistant")
      ?.text.trim()
      .slice(0, 2000);
    const chips = last?.tools.map((tool) => `${tool.name} — ${tool.status}`).join("; ");
    return {
      note: `Чат агента ${chat.agent}`,
      text: readoutLines(
        `Бэкенд: ${chat.backend}`,
        chat.busy.value ? `Состояние: Работает (${chat.phase.value})` : "Состояние: Готов",
        chat.error.value ? `Ошибка: ${chat.error.value}` : "",
        ...chat.controls.value.map(
          (control) =>
            `${control.name}: ${control.options.find((item) => item.value === control.current)?.name ?? control.current}`,
        ),
        `Сообщений: ${chat.turns.value.length}`,
        answer ? `Последний ответ:\n${answer}` : "",
        chips ? `Инструменты: ${chips}` : "",
      ),
    };
  });
}
