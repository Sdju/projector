import type { AgentSelection } from "../model/types.ts";

interface DoctorInput {
  error: string;
  history?: string;
  selection?: AgentSelection;
  signal?: AbortSignal;
}

/** Asks the Projector Form Doctor to rewrite a form the compiler rejected. */
export async function repairForm(input: DoctorInput & { form: string }): Promise<string> {
  const response = await fetch("/api/agent/form-repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: input.signal,
  });
  const data = (await response.json().catch(() => ({}))) as { form?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Form Doctor недоступен");
  if (typeof data.form !== "string" || !data.form.trim())
    throw new Error("Form Doctor не вернул форму");
  return data.form;
}

/** Asks the Projector Answer Doctor to repair visible markup in a finished answer. */
export async function repairAnswer(input: DoctorInput & { answer: string }): Promise<string> {
  const response = await fetch("/api/agent/answer-repair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal: input.signal,
  });
  const data = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (!response.ok) throw new Error(data.error || "Answer Doctor недоступен");
  if (typeof data.answer !== "string" || !data.answer.trim())
    throw new Error("Answer Doctor не вернул ответ");
  return data.answer;
}
