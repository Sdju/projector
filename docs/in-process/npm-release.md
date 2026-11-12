# Выпуск в npm: что осталось

Рабочий документ: только незакрытые проверки. Устройство поставки и процедура публикации —
[distribution](../distribution.md); ограничения установки — там же.

Пакеты `@ai-projector/ide`, `@ai-projector/native` и `@ai-projector/hub` опубликованы
10.11.2026. `0.11.0` выпущен вручную, `0.11.1` — через OIDC с SLSA provenance: этим trusted
publisher подтверждён. `0.12.0` выпущен 12.11.2026 из GitHub Release тем же OIDC: все три
пакета с provenance, повторный запуск workflow пропускает уже опубликованные версии.

## Открыто

- [ ] `npm install -g` в чистый prefix на npm 11 и npm 12 (`--allow-scripts=node-pty` для IDE,
      `node-pty,node-gtk` для native) ставит пакет, поднимает PTY и prod-сервер.
- [ ] `projector-install-desktop` из глобального пакета создаёт пункт меню и запускает
      `bin/projector` с ресурсами, иконками и рабочим каталогом.
- [ ] После подтверждения OIDC включён режим **Require two-factor authentication and disallow
      tokens** (если ещё не включён).

## Проверки перед закрытием

- [ ] Чистая машина без Node, GTK и build tools: установка, запуск, обновление.
- [ ] `vp run build:distribution` и `vp run check` остаются зелёными.

Когда проверки закрыты, удалите этот файл и пункт из `docs/in-process/README.md`; ограничения,
которые останутся навсегда, живут в [distribution](../distribution.md#известные-ограничения-установки).
