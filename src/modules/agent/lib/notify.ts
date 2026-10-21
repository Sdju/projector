/**
 * Tells the user, outside the page, that an agent finished or is waiting for a decision. Only a
 * page the user is not looking at notifies, and only after they allowed notifications.
 */
function hidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function show(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !hidden())
    return;
  try {
    new Notification(title, { body: body.slice(0, 200), tag });
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

/** Asked at the first message, which is a user action; a refusal is remembered by the browser. */
export async function requestNotifications(): Promise<void> {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  try {
    await Notification.requestPermission();
  } catch {
    // Not available in this context.
  }
}

export function notifyAnswer(text: string, failed: boolean): void {
  show(failed ? "Агент остановился с ошибкой" : "Агент закончил", text.trim(), "agent-answer");
}

export function notifyQuestion(what: string): void {
  show("Агент задаёт вопрос", what, "agent-question");
}

export function notifyPermission(what: string): void {
  show("Агент ждёт разрешения", what, "agent-permission");
}

/** A background job ended or waits for the user; the tag keeps one notification per job. */
export function notifyJob(id: string, title: string, body: string): void {
  show(title, body, `agent-job:${id}`);
}
