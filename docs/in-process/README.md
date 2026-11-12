# Рабочие материалы

Здесь лежат временные документы: дорожные карты, открытые вопросы, варианты решений и планы работ. Это не справочник по проекту и не история.

## Правила

- Документ заводится под конкретную работу и содержит только открытые пункты.
- Текущее устройство не дублируется: ссылайтесь на `docs/architecture.md`, `docs/session-notes.md` и профильные документы.
- Сделанный пункт удаляется. Если результат меняет поведение, он попадает в код, справочную документацию и `CHANGELOG.md`.
- Когда работа закрыта, файл удаляется; пустые файлы не хранятся.
- История остаётся в Git и `CHANGELOG.md`, задачи — в issue/PR.

## Сейчас

- [review-workflow.md](review-workflow.md) — цикл ревью изменений: замечания к diff, stage по хунку, commit и push, частичное принятие работы задания, удалённые комментарии и approve.
- [workspace-ux.md](workspace-ux.md) — навигация и сохранность рабочего места: быстрое открытие, история и blame файла, поиск в терминале, внешний редактор, восстановление окна и локальная история.
- [delivery.md](delivery.md) — установка без сборочного окружения и доступ с телефона: бинарная поставка, автообновление, HTTPS, QR для LAN и Web Push.
- [cursor-acp.md](cursor-acp.md) — оставшиеся пункты ACP Cursor: форк и подпись модели; ограничения CLI (`--trust`, Team MCP) описаны в [usage](../usage.md).
- [agent-roadmap.md](agent-roadmap.md) — открытые пункты штатного агента Projector и проверки Судьи в браузере.
- [plugin-agents.md](plugin-agents.md) — что осталось у агентов-плагинов: hosted-жизненный цикл, статусы исчезнувшего агента, пресеты диалектов и изолированный runtime.
- [plugin-concept/concept.md](plugin-concept/concept.md) — будущее плагинов: npm-поставка, browser runtime, UI и Node capabilities; текущие вклады и доверие — [plugins](../plugins.md).
- [analytics-agent-logs.md](analytics-agent-logs.md) — расход по нативным журналам Codex, OpenCode, Kimi и Cursor: читатели журналов, нормализация, дедупликация, цена и покрытие.
- [color-schemes.md](color-schemes.md) — цветовые схемы интерфейса: остались потребители вне CSS (редактор, Markdown, ANSI-палитра терминала, иконки и статика), доводка светлой и контрастной схем и проверки.
- [file-views.md](file-views.md) — что осталось у файловых снимков: произвольные папки, union-дерево, индекс, поиск по снимку и переименования.
- [gitlab-client-roadmap.md](gitlab-client-roadmap.md) — что осталось у GitLab после паритета с GitHub: Snippets, Wiki, несколько инстансов и проверки.
- [npm-release.md](npm-release.md) — что осталось после публикации `0.11.1`: версия в дереве, чистая установка, desktop/hub и 2FA.
- [opencode-background-subagents.md](opencode-background-subagents.md) — фоновый `subagent` OpenCode не виден как живая задача, поэтому Lens не читает его рассуждения.
