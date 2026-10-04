import type { DevcontainerFinding } from "./contract.ts";

type Config = Record<string, unknown>;
const nonEmpty = (value: unknown) =>
  Array.isArray(value)
    ? value.length > 0
    : value !== null && typeof value === "object"
      ? Object.keys(value).length > 0
      : Boolean(value);

const LIFECYCLE = [
  "onCreateCommand",
  "updateContentCommand",
  "postCreateCommand",
  "postStartCommand",
  "postAttachCommand",
] as const;

/**
 * Lists what a devcontainer.json asks for beyond the restricted model
 * (image, ports, environment, non-root user). An empty list means the
 * configuration needs no trust decision.
 */
export function classifyDevcontainer(config: unknown): DevcontainerFinding[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const input = config as Config;
  const findings: DevcontainerFinding[] = [];
  const add = (finding: DevcontainerFinding) => findings.push(finding);

  if (nonEmpty(input.initializeCommand))
    add({
      id: "initialize-command",
      risk: "host",
      title: "Команда на вашем компьютере",
      detail:
        "initializeCommand выполняется на хосте, вне контейнера, с вашими правами и доступом к файлам.",
      keys: ["initializeCommand"],
    });
  const privileged = ["privileged", "capAdd", "securityOpt"].filter((key) => nonEmpty(input[key]));
  if (privileged.length)
    add({
      id: "privileges",
      risk: "host",
      title: "Расширенные права контейнера",
      detail: "Снимает ограничения изоляции: привилегированный режим, capabilities или security-опции.",
      keys: privileged,
    });
  if (nonEmpty(input.runArgs))
    add({
      id: "run-args",
      risk: "host",
      title: "Произвольные аргументы docker run",
      detail: "runArgs передаются Docker как есть и могут менять сеть, устройства и доступ к хосту.",
      keys: ["runArgs"],
    });
  const mounts = ["mounts", "workspaceMount"].filter((key) => nonEmpty(input[key]));
  if (mounts.length)
    add({
      id: "mounts",
      risk: "host",
      title: "Монтирование путей хоста",
      detail: "Контейнер получает доступ к дополнительным папкам или сокетам хоста.",
      keys: mounts,
    });
  if (nonEmpty(input.dockerComposeFile))
    add({
      id: "compose",
      risk: "host",
      title: "Docker Compose",
      detail: "Запускает сервисы из Compose-файла репозитория со всеми их настройками.",
      keys: ["dockerComposeFile"],
    });
  const build = nonEmpty(input.build) ? ["build"] : [];
  if (build.length)
    add({
      id: "build",
      risk: "root",
      title: "Сборка образа из Dockerfile",
      detail: "Команды Dockerfile выполняются при сборке от root, обычно с доступом к сети.",
      keys: build,
    });
  if (nonEmpty(input.features))
    add({
      id: "features",
      risk: "root",
      title: "Dev Container Features",
      detail: "Скрипты установки загружаются из реестров и выполняются при сборке от root.",
      keys: ["features"],
    });
  const lifecycle = LIFECYCLE.filter((key) => nonEmpty(input[key]));
  if (lifecycle.length)
    add({
      id: "lifecycle",
      risk: "container",
      title: "Команды при создании и запуске",
      detail: "Выполняются в контейнере автоматически, с доступом к вашему проекту.",
      keys: [...lifecycle],
    });
  if (input.remoteUser === "root" || input.containerUser === "root")
    add({
      id: "root-user",
      risk: "root",
      title: "Работа от root",
      detail: "Процессы в контейнере запускаются от имени root.",
      keys: ["remoteUser", "containerUser"].filter((key) => input[key] === "root"),
    });
  return findings;
}
