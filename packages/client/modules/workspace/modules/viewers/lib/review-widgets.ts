import { WidgetType } from "@codemirror/view";

export interface InlineReviewComment {
  id: string;
  from: number;
  to: number;
  text: string;
}

export interface ReviewEditorHandlers {
  onStart: (from: number, to: number, snippet: string) => void;
  onSubmit: (text: string) => void;
  onUpdate: (id: string, text: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id?: string) => void;
  onCancel: () => void;
}

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

function formatLineLabel(from: number, to: number) {
  return from === to ? `строка ${from}` : `строки ${from}–${to}`;
}

function svgIcon(paths: string[]) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const pencilIcon = () =>
  svgIcon([
    "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",
  ]);
const trashIcon = () =>
  svgIcon([
    "M3 6h18",
    "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
    "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
  ]);
const closeIcon = () => svgIcon(["M18 6 6 18", "m6 6 12 12"]);

function iconButton(
  icon: SVGSVGElement,
  title: string,
  command: string,
  onClick: () => void,
  danger = false,
) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = danger ? "cm-review-icon danger" : "cm-review-icon";
  button.title = title;
  button.setAttribute("aria-label", title);
  if (command) button.dataset.command = command;
  button.append(icon);
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return button;
}

export class ReviewCommentWidget extends WidgetType {
  readonly comment: InlineReviewComment;
  readonly handlers: ReviewEditorHandlers;
  constructor(comment: InlineReviewComment, handlers: ReviewEditorHandlers) {
    super();
    this.comment = comment;
    this.handlers = handlers;
  }
  eq(other: ReviewCommentWidget) {
    return (
      other.comment.id === this.comment.id &&
      other.comment.from === this.comment.from &&
      other.comment.to === this.comment.to &&
      other.comment.text === this.comment.text
    );
  }
  get estimatedHeight() {
    return 44 + this.comment.text.split("\n").length * 20;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-review-slot";

    const card = document.createElement("div");
    card.className = "cm-review-card";
    card.dataset.reviewCommentId = this.comment.id;

    const head = document.createElement("div");
    head.className = "cm-review-head";

    const badge = document.createElement("span");
    badge.className = "cm-review-range";
    badge.textContent = formatLineLabel(this.comment.from, this.comment.to);

    const actions = document.createElement("div");
    actions.className = "cm-review-actions";
    actions.append(
      iconButton(pencilIcon(), "Изменить замечание", "ide.review.comment.update", () =>
        this.handlers.onEdit(this.comment.id),
      ),
      iconButton(
        trashIcon(),
        "Удалить замечание",
        "ide.review.comment.remove",
        () => this.handlers.onRemove(this.comment.id),
        true,
      ),
    );
    head.append(badge, actions);

    const body = document.createElement("div");
    body.className = "cm-review-text";
    body.textContent = this.comment.text;

    card.append(head, body);
    wrap.append(card);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

export class ReviewComposerWidget extends WidgetType {
  readonly mode: "create" | "edit";
  readonly from: number;
  readonly to: number;
  readonly commentId?: string;
  readonly initialText: string;
  readonly handlers: ReviewEditorHandlers;
  constructor(options: {
    mode: "create" | "edit";
    from: number;
    to: number;
    commentId?: string;
    initialText?: string;
    handlers: ReviewEditorHandlers;
  }) {
    super();
    this.mode = options.mode;
    this.from = options.from;
    this.to = options.to;
    this.commentId = options.commentId;
    this.initialText = options.initialText ?? "";
    this.handlers = options.handlers;
  }
  eq(other: ReviewComposerWidget) {
    return (
      other.mode === this.mode &&
      other.from === this.from &&
      other.to === this.to &&
      other.commentId === this.commentId &&
      other.initialText === this.initialText
    );
  }
  get estimatedHeight() {
    return 146;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "cm-review-slot";

    const form = document.createElement("form");
    form.className = "cm-review-card cm-review-composer";

    const head = document.createElement("div");
    head.className = "cm-review-head";

    const title = document.createElement("span");
    title.className = "cm-review-range";
    title.textContent =
      this.mode === "edit"
        ? `Правка · ${formatLineLabel(this.from, this.to)}`
        : `Замечание · ${formatLineLabel(this.from, this.to)}`;
    head.append(
      title,
      iconButton(closeIcon(), "Закрыть (Esc)", "", () => this.handlers.onCancel()),
    );

    const textarea = document.createElement("textarea");
    textarea.className = "cm-review-input";
    textarea.rows = 3;
    textarea.placeholder = "Опишите замечание…";
    textarea.setAttribute("aria-label", "Текст замечания");
    textarea.value = this.initialText;

    const errorEl = document.createElement("p");
    errorEl.className = "cm-review-error";
    errorEl.setAttribute("role", "alert");
    errorEl.hidden = true;

    const foot = document.createElement("div");
    foot.className = "cm-review-foot";

    const hint = document.createElement("span");
    hint.className = "cm-review-hint";
    hint.textContent = `${isMac() ? "⌘" : "Ctrl"}+Enter — ${this.mode === "edit" ? "сохранить" : "добавить"}`;

    const buttons = document.createElement("div");
    buttons.className = "cm-review-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "cm-review-btn";
    cancelBtn.textContent = "Отмена";
    cancelBtn.addEventListener("click", () => this.handlers.onCancel());

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "cm-review-btn primary";
    submitBtn.textContent = this.mode === "edit" ? "Сохранить" : "Добавить";
    submitBtn.dataset.command =
      this.mode === "edit" ? "ide.review.comment.update" : "ide.review.comment.add";
    submitBtn.disabled = !textarea.value.trim();

    const submit = () => {
      const value = textarea.value.trim();
      if (!value) return;
      try {
        if (this.mode === "edit" && this.commentId) this.handlers.onUpdate(this.commentId, value);
        else this.handlers.onSubmit(value);
      } catch (err) {
        errorEl.textContent = err instanceof Error ? err.message : "Не удалось сохранить замечание";
        errorEl.hidden = false;
      }
    };

    textarea.addEventListener("input", () => {
      submitBtn.disabled = !textarea.value.trim();
      errorEl.hidden = true;
    });
    textarea.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.handlers.onCancel();
      } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        submit();
      }
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submit();
    });

    buttons.append(cancelBtn, submitBtn);
    foot.append(hint, buttons);
    form.append(head, textarea, errorEl, foot);
    wrap.append(form);

    requestAnimationFrame(() => {
      textarea.focus({ preventScroll: true });
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}
