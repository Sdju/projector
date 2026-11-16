---
description: Просмотр GitHub и CI (GitHub Actions, GitLab) только для чтения: репозиторий, issues, PR, discussions, pipelines и jobs.
---

# GitHub и CI (только чтение)

Используй команды просмотра через `list_commands` → `describe_command` → `execute_command`. Доступно только чтение, без клонирования, записи, запуска, отмены и перезапуска джобов.

- **GitHub (только в GitHub-проектах):**
  - Репозиторий: `ide.github.repository.info` / `refresh` в scope `github:<projectId>`.
  - Issues: `ide.issues.*` (`block.toggle`, `filter`, `refresh`, `more`, `open`) в scope `issues:<projectId>`.
  - Pull requests: `ide.pulls.*` (те же пять команд) в scope `pulls:<projectId>`.
  - Discussions (нужен вход в GitHub): `ide.discussions.*` (те же пять команд) в scope `discussions:<projectId>`.
- **CI (GitHub Actions и GitLab):**
  - Список: `ide.pipelines.*` (`block.toggle`, `filter`, `refresh`, `more`, `open`) в scope `pipelines:<projectId>`.
  - Вкладка pipeline (`pipeline:<projectId>:<pipelineId>`): `ide.pipeline.refresh`, `ide.pipeline.job.open`, `ide.pipeline.file.open` (workflow или аннотация), `ide.pipeline.pull.open`. На GitHub показывает `display_title`, шаги, аннотации check run, usage и файл workflow.
  - Вкладка job (`job:<projectId>:<jobId>`): `ide.job.refresh`, `ide.job.file.open`.
- Показывай статусы, ветку, джобы и лог так, как они получены из вкладок и команд.
