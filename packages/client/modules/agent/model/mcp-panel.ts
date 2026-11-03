import { ref } from "vue";
import { fetchMcpServers, type McpServer } from "../api/client.ts";
import type { AgentBackendId } from "./types.ts";

/** The MCP servers of an external agent, read when its parameters island opens. */
export function useMcpServers(backend: () => AgentBackendId, projectId: string) {
  const mcp = ref<McpServer[]>([]);
  async function load(): Promise<void> {
    try {
      mcp.value = await fetchMcpServers(backend(), projectId);
    } catch {
      mcp.value = [];
    }
  }
  return { mcp, load };
}
