import type { ModelMessage } from "ai";

/** One repair round: the original text, the last reply and the fresh diagnosis. */
export interface DoctorRound {
  kind: "answer" | "form";
  /** The text before the first repair; the round always starts from it. */
  original: string;
  /** The diagnosis that opened the round. */
  originalError: string;
  /** What the automatic check says about the current candidate. */
  error: string;
  history?: string;
  /** The doctor's previous reply, raw: the model sees it as its own turn. */
  previous?: string;
  /** 1-based attempt of this round. */
  attempt: number;
  /** How many attempts the client allows. */
  limit: number;
}

const LABELS = {
  answer: {
    broken: "Сломанный ответ",
    diagnosis: "Диагностика",
    ask: "Верни весь исправленный ответ.",
  },
  form: {
    broken: "Ошибочная форма",
    diagnosis: "Ошибка компилятора",
    ask: "Верни исправленную форму.",
  },
} as const;

/**
 * Messages of the same repair round. The first request carries the conversation and the broken
 * text; a retry adds the doctor's own previous reply and the new diagnosis, so the model
 * continues its work instead of rebuilding everything from scratch.
 */
export function doctorMessages(round: DoctorRound): ModelMessage[] {
  const labels = LABELS[round.kind];
  const history = (round.history ?? "").slice(-20_000);
  const first = `История чата (последние сообщения):\n${history || "нет"}\n\n${labels.broken}:\n${round.original}\n\n${labels.diagnosis}:\n${round.originalError}\n\n${labels.ask}`;
  if (round.attempt <= 1 || !round.previous) return [{ role: "user", content: first }];
  return [
    { role: "user", content: first },
    { role: "assistant", content: round.previous },
    {
      role: "user",
      content: `Продолжаем тот же ремонт, попытка ${round.attempt} из ${round.limit}. Не начинай заново и не переписывай то, что уже корректно.\n\nПроверка после твоей прошлой правки:\n${round.error}\n\nЕсли проверка ошибается, а разметка корректна, верни первой строкой PROJECTOR-DOCTOR: VALID и со следующей строки — короткую причину. Больше ничего в ответе быть не должно.`,
    },
  ];
}
