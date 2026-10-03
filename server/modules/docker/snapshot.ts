import { os } from "../../../core/modules/os/index.ts";
import type { DockerContainer, DockerSnapshot } from "../../../core/modules/docker/index.ts";
import { dockerSettings, dockerContexts, readBinding, detectedComposeFiles } from "./settings.ts";

export function containerSummary(item: any): DockerContainer {
  const labels = item.Config?.Labels ?? {};
  const ports: DockerContainer["ports"] = [];
  for (const [key, values] of Object.entries(item.NetworkSettings?.Ports ?? {})) {
    const [privatePort, protocol] = key.split("/");
    for (const port of (values as { HostIp: string; HostPort: string }[] | null) ?? []) {
      const address = port.HostIp || "0.0.0.0";
      const host =
        address === "0.0.0.0"
          ? "127.0.0.1"
          : address === "::"
            ? "[::1]"
            : address.includes(":")
              ? `[${address}]`
              : address;
      ports.push({
        address,
        privatePort: Number(privatePort),
        publicPort: Number(port.HostPort),
        protocol: protocol!,
        url: protocol === "tcp" ? `http://${host}:${port.HostPort}` : null,
      });
    }
  }
  return {
    id: item.Id,
    name: String(item.Name).replace(/^\//, ""),
    image: item.Config?.Image ?? "",
    state: item.State?.Status ?? "unknown",
    health: item.State?.Health?.Status ?? null,
    exitCode: item.State?.ExitCode ?? 0,
    startedAt: item.State?.StartedAt ?? "",
    project: labels["com.docker.compose.project"] ?? "",
    service: labels["com.docker.compose.service"] ?? "",
    workingDirectory: labels["com.docker.compose.project.working_dir"] ?? "",
    ports,
    mounts: (item.Mounts ?? []).map((mount: any) => ({
      type: mount.Type,
      source: mount.Source,
      target: mount.Destination,
      writable: !!mount.RW,
    })),
  };
}
export async function dockerSnapshot(
  project?: { id: string; path: string },
  requestedContext?: string,
): Promise<DockerSnapshot> {
  const settings = await dockerSettings();
  const binding = project ? await readBinding(project.id) : null;
  const result: DockerSnapshot = {
    ...settings,
    context: requestedContext || binding?.context || settings.context,
    contexts: [],
    connected: false,
    version: "",
    composeVersion: "",
    error: "",
    containers: [],
    binding,
    detectedFiles: project ? await detectedComposeFiles(project.path) : [],
  };
  try {
    result.contexts = await dockerContexts();
    if (!settings.enabled) return result;
    if (!result.contexts.some((item) => item.name === result.context && item.local))
      throw new Error("Выбранный Docker context недоступен или не является локальным");
    const prefix = ["--context", result.context];
    const { stdout } = await os.tools.runDocker([
      ...prefix,
      "info",
      "--format",
      "{{.ServerVersion}}",
    ]);
    result.version = stdout.trim();
    result.connected = true;
    try {
      result.composeVersion = (
        await os.tools.runDocker([...prefix, "compose", "version", "--short"])
      ).stdout.trim();
    } catch {
      /* CLI plugin missing; container actions still work. */
    }
    const ids = (await os.tools.runDocker([...prefix, "ps", "-aq", "--no-trunc"])).stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    for (let offset = 0; offset < ids.length; offset += 50) {
      const inspected = await os.tools.runDocker([
        ...prefix,
        "inspect",
        "--type",
        "container",
        ...ids.slice(offset, offset + 50),
      ]);
      result.containers.push(...JSON.parse(inspected.stdout).map(containerSummary));
    }
  } catch (error) {
    result.connected = false;
    result.containers = [];
    result.error = error instanceof Error ? error.message : "Docker недоступен";
  }
  return result;
}
