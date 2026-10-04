export interface DockerEnvironment {
  kind: "docker";
  context: string;
  image: string;
  network: "none" | "bridge";
  /** Container ports; Docker assigns loopback host ports at each launch. */
  ports: number[];
}
export const DEFAULT_ENVIRONMENT_IMAGE = "node:24-bookworm";
