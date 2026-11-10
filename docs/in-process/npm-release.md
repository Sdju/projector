# Выпуск в npm

Подготовка поставки `@projector-ai/ide`, `@projector-ai/native` и `@projector-ai/hub` закончена: имена, манифесты, `projector-install-desktop`, `projector-hub`, `verify:distribution` и OIDC-workflow уже в коде. В registry пакетов ещё нет, публикаций не было. Устройство поставки и порядок публикации — в [distribution](../distribution.md); здесь только незакрытые пункты.

## Первый выпуск

- [ ] Опубликовать все три пакета вручную с локальным `npm login` и 2FA — trusted publisher нельзя настроить до появления пакета.
- [ ] Настроить trusted publisher для каждого пакета: `Sdju/projector`, `publish.yml`, разрешить `npm publish`.
- [ ] Подтвердить конфигурацию первым успешным OIDC-publish из GitHub Release — на это даётся два дня.
- [ ] После OIDC включить для пакетов `Require two-factor authentication and disallow tokens`.

## Открытые ограничения

- [ ] Глобальная установка `@projector-ai/native` на npm 11/12 падает в install-скрипте `node-gtk` (`npx node-pre-gyp`). Workaround описан в [distribution](../distribution.md#известные-ограничения-установки), причина не устранена: нужен либо надёжный install-скрипт, либо отказ от сборки при установке.
- [ ] `engines` допускает только Node `>=24.11.0 <25`. На Node 26 npm выдаёт `EBADENGINE`; расширять диапазон можно после проверки PTY и сервера на новой версии.
- [ ] Установка на Windows и macOS не проверялась в этой работе: тесты поставки шли на Linux. Для `node-pty` там нужны свои build tools или prebuilt-бинарники.
- [ ] `projector-install-desktop` из глобального npm-пакета не запускался вручную: проверено только наличие bin и путей к `bin/projector`, ресурсам и иконкам в артефакте.
- [ ] Установка `@projector-ai/hub` в чистый prefix и запуск `projector-hub` с реальным устройством ещё не проверялись.

## Проверить после публикации

- [ ] Повторный запуск workflow на уже опубликованной версии пропускает пакеты и завершается успешно.
- [ ] `npm install -g` в чистый prefix с npm 11 и npm 12 (`--allow-scripts`) ставит IDE, поднимает PTY и prod-сервер.
- [ ] `projector-hub` из npm открывает страницу входа и туннель к локальному Projector без checkout.
- [ ] В документации и README нет ссылок на неопубликованные имена и локальные tarball как основной путь установки.
