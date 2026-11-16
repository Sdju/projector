---
description: Сетевой доступ Projector (local/lan, пароль) и OpenAI-совместимый API-шлюз (origins, apiKey, квота).
---

# Доступ по сети и OpenAI-совместимый API

Перед изменением открой нужный раздел настроек (`ide.workbench.settings.open` + `ide.settings.section.open`) или панель, чтобы появился соответствующий scope.

- **Доступ по сети (`surface=network`, `view=settings` или `panel`):**
  - `ide.network.refresh` перечитывает режим и адреса; `ide.network.save` принимает `mode` (`local`/`lan`) и `password`; `ide.network.password.clear` убирает пароль; `ide.network.address.copy` доступна в LAN-панели.
  - Смена `mode` перезапускает сервер и завершает терминалы и дочерние процессы; смена пароля рестарта не требует.
- **OpenAI-совместимый API (`openai-api`, scope `surface=openaiGateway`):**
  - Включённый API тратит квоту провайдеров — включай только по явной просьбе пользователя.
  - `ide.openai.gateway.refresh` перечитывает состояние.
  - `ide.openai.gateway.set` принимает `enabled` (`true`/`false`), `apiKey` (пустая строка убирает ключ) и `origins` (массив разрешённых origin браузера; шаблоны `"@localhost"` и `"@lan"` разрешают любую страницу этой машины / локальной сети; `[]` очищает).
