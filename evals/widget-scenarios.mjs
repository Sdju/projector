/**
 * Widget scenarios for an external agent (OpenCode through ACP). They check the observable answer:
 * the agent must use the compact Field entry and must not fall back to the old Input/Checks/Slider
 * aliases, which are render-only now.
 */
export const widgetScenarios = [
  {
    id: "field-launch",
    title: "Собирает настройки запуска через Field",
    message:
      "Собери настройки запуска проекта одной формой Projector: режим server или window, порт и автозапуск. Используй Field. Ничего не меняй без моего ответа.",
    expect: {
      answer: /<(IntelligentForm|Form)\b/,
      answerAll: [
        /<Field[^>]*type="(select|radio|segmented)"/,
        /<Field[^>]*type="number"/,
        /<Field[^>]*type="switch"/,
      ],
      notInAnswer: /<(Input|Checks|Slider)\b/,
      formFields: 3,
    },
  },
  {
    id: "field-release",
    title: "Собирает параметры релиза через Field",
    message:
      "Собери параметры релиза одной формой Projector: ветка, версия, обновлять ли CHANGELOG и публиковать ли тег. Используй Field.",
    expect: {
      answer: /<(IntelligentForm|Form)\b/,
      answerAll: [/<Field\b/, /<Field[^>]*type="switch"/],
      notInAnswer: /<(Input|Checks|Slider)\b/,
      formFields: 4,
    },
  },
  {
    id: "field-docker",
    title: "Собирает настройки Docker через Field",
    message:
      "Настрой Docker для проекта одной формой Projector: сеть none или bridge, порт, лимит памяти и нужно ли поднимать контейнер после создания. Используй Field. Сначала уточни параметры.",
    expect: {
      answer: /<(IntelligentForm|Form)\b/,
      answerAll: [
        /<Field[^>]*type="(select|radio|segmented)"/,
        /<Field[^>]*type="(number|slider)"/,
        /<Field[^>]*type="switch"/,
      ],
      notInAnswer: /<(Input|Checks|Slider)\b/,
      formFields: 4,
    },
  },
  {
    id: "widget-html-content",
    title: "Пишет содержимое виджета валидным HTML",
    message:
      "Сделай в одной карточке Projector отчёт о проверке релиза: HTML-заголовок, вводный абзац, список из трёх шагов с жирными названиями и inline code, и таблицу из трёх строк «Проверка / Команда / Ожидание». Ничего не выполняй.",
    expect: {
      answer: /<Card\b/,
      answerAll: [/<h[1-6]\b/, /<strong\b/, /<(ul|ol)\b/, /<code\b/, /<table\b/, /<tr\b/],
      validWidgets: true,
    },
  },
];
