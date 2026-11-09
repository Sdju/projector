const numbers = new Intl.NumberFormat("ru");

/** Human token figures: 1 240, 12,4 тыс., 2,1 млн, 1,3 млрд. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value < 1000) return numbers.format(Math.round(value));
  if (value < 1_000_000) return `${trim(value / 1000)} тыс.`;
  if (value < 1_000_000_000) return `${trim(value / 1_000_000)} млн`;
  return `${trim(value / 1_000_000_000)} млрд`;
}

function trim(value: number): string {
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return numbers.format(rounded);
}

/** Cost is in the currency of the model's own tariff; only the figure is meaningful here. */
export function formatCost(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  return new Intl.NumberFormat("ru", {
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

/** A provider balance with its currency: `$0,24`, `¥110,00`, or `0,24 XYZ` when unknown. */
export function formatMoney(value: number, currency: string): string {
  if (!Number.isFinite(value)) return "—";
  try {
    return new Intl.NumberFormat("ru", {
      style: "currency",
      currency,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  } catch {
    return `${formatCost(value)} ${currency}`;
  }
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}%`;
}

/** `YYYY-MM-DD` as `дд.мм`, without a Date and its timezone shifts. */
export function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return month && date ? `${date}.${month}` : day;
}

/** A timestamp as the local `дд.мм` label of a chart point. */
export function formatDayAt(at: number): string {
  const date = new Date(at);
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** A timestamp as `чч:мм`, for balance points that all happen within a day or two. */
export function formatTimeAt(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function formatRange(days: number): string {
  const last = days % 10;
  const lastTwo = days % 100;
  const word =
    lastTwo >= 11 && lastTwo <= 14
      ? "дней"
      : last === 1
        ? "день"
        : last >= 2 && last <= 4
          ? "дня"
          : "дней";
  return `${days} ${word}`;
}

/** Window names the adapters use, in the words the status bar already shows. */
export function windowLabel(window: string): string {
  switch (window) {
    case "rolling":
      return "5 часов";
    case "weekly":
      return "Неделя";
    case "monthly":
      return "Месяц";
    case "total":
      return "Всего";
    case "auto":
      return "Авто-модели";
    case "api":
      return "API-модели";
    default:
      return window;
  }
}
