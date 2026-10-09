import { os } from "../../../core/modules/os/index.ts";
import {
  DEFAULT_ENVIRONMENT_IMAGE,
  type DockerEnvironment,
} from "../../../core/modules/environment/index.ts";
import { HttpError } from "../http/index.ts";

export function parseDockerEnvironment(
  value: unknown,
  context = "default",
): DockerEnvironment | undefined {
  if (value === undefined || value === "local") return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Некорректное окружение");
  const input = value as Record<string, unknown>;
  if (
    input.kind !== "docker" ||
    Object.keys(input).some((key) => !["kind", "image", "network", "ports"].includes(key))
  )
    throw new HttpError(400, "Docker-окружение принимает только image, network и ports");
  const image = input.image ?? DEFAULT_ENVIRONMENT_IMAGE;
  const network = input.network ?? "none";
  const ports = input.ports ?? [];
  if (
    typeof image !== "string" ||
    image.length > 256 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)
  )
    throw new HttpError(400, "Некорректный Docker image");
  if (network !== "none" && network !== "bridge")
    throw new HttpError(400, "network: none или bridge");
  if (
    !Array.isArray(ports) ||
    ports.length > 5 ||
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) ||
    new Set(ports).size !== ports.length
  )
    throw new HttpError(400, "Укажите до пяти уникальных TCP-портов");
  if (network === "none" && ports.length)
    throw new HttpError(400, "Публикация портов требует сети bridge");
  return { kind: "docker", context, image, network, ports };
}
export async function prepareDockerEnvironment(
  environment: DockerEnvironment,
  options: { signal?: AbortSignal; onPull?: () => void } = {},
) {
  const result = await os.tools.runDocker(["context", "inspect", environment.context]);
  const context = JSON.parse(result.stdout)[0];
  if (!/^(?:unix|npipe):\/\//.test(context?.Endpoints?.docker?.Host ?? ""))
    throw new HttpError(400, "Docker-окружения поддерживают только локальный Unix socket");
  await os.tools.runDocker([
    "--context",
    environment.context,
    "info",
    "--format",
    "{{.ServerVersion}}",
  ]);
  const prefix = ["--context", environment.context];
  try {
    await os.tools.runDocker([...prefix, "image", "inspect", environment.image], {
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    options.onPull?.();
    await os.tools.runDocker([...prefix, "pull", environment.image], {
      timeout: 300_000,
      signal: options.signal,
    });
  }
}
