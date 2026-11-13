---
description: Настройка возможностей, ролей, моделей и сессий агентов (ide.agent.features.*, controls.*, sessions.*, role.edit).
---

# Управление агентами и их настройками

Меняй возможности, модели и сессии только по явной просьбе пользователя.

- **Возможности агентов (features):**
  - Только для текущего чата (остров в табе агента): `ide.agent.features.chat.list`, `ide.agent.features.chat.set` (`feature`, `enabled`), `ide.agent.features.chat.reset`, `ide.agent.features.panel`.
  - Умолчания для новых чатов (настройки, раздел `agents`, страница нужного агента): `ide.agent.features.defaults.list` и `ide.agent.features.defaults.set` (`feature`, `agent`, `enabled`). Часть агентов применяет изменение со следующего сообщения, часть — в новой сессии.
- **Контролы и сессии внешних агентов (в scope чата):**
  - `ide.agent.controls.list` показывает текущие модель, усилие и режим; `ide.agent.control.set` (`id`, `value`) меняет их со следующего сообщения.
  - `ide.agent.sessions.list` перечисляет прошлые сессии; `ide.agent.session.resume` (`sessionId`) открывает её в этом чате; `ide.agent.session.delete` (`sessionId`, `confirm: true`) удаляет навсегда (только по явной просьбе).
- **Редактор chat-роли:** `ide.agent.role.edit` с `role` из `ide.agent.roles.chat.list` (глобальная открывает раздел `agent-roles`, проектная — настройки проекта, раздел `roles`).
