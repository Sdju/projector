import type { AgentRunOptions } from "../../agent/index.ts";
import { enabledFeatureText, featureText } from "../../agent-features/index.ts";
import { rolePromptText, roleTemplateTitle } from "../../agent-roles/index.ts";
import type { ProjectWidgetDefinition } from "@ai-projector/core/modules/widget-catalog/index.ts";
import { projectInstructions } from "./project-instructions.ts";
import { memorySection } from "./projector-memory.ts";
import { mcpSection, type McpConnection } from "./projector-mcp.ts";
import { skillsSection, type Skill } from "./projector-skills.ts";
import { buildSystemPrompt } from "./prompts.ts";
import { summarySection } from "./projector-compaction.ts";
import { widgetCatalog } from "./widgets.ts";

/**
 * The Projector system prompt. A templated role replaces the assembled prompt and decides where
 * each section goes; a plain role keeps the usual prompt with its instructions appended.
 */
export async function projectorSystem(
  options: AgentRunOptions,
  context: {
    projectWidgets: ProjectWidgetDefinition[];
    skills: Skill[];
    mcp: McpConnection;
    summary: string;
  },
): Promise<string> {
  const [featuresText, widgetsFeature, project, memory] = await Promise.all([
    enabledFeatureText("projector", options.features),
    featureText("projector", "widgets", options.features),
    projectInstructions(options.cwd),
    memorySection(options.cwd),
  ]);
  const skillsText = skillsSection(context.skills);
  const summaryText = summarySection(context.summary);
  const projectWidgetsText = context.projectWidgets.length
    ? widgetCatalog.extraGuide(context.projectWidgets)
    : "";
  const projectSection = [options.cwd ? `Текущий проект: ${options.cwd}` : "", project.trim()]
    .filter(Boolean)
    .join("\n\n");
  const mcpText = mcpSection(context.mcp);
  if (!options.role?.template || !options.role.prompt?.trim())
    return (
      buildSystemPrompt([featuresText, projectWidgetsText].filter(Boolean).join("\n\n")) +
      (options.cwd ? `\n${projectSection}` : "") +
      memory +
      mcpText +
      skillsText +
      summaryText +
      rolePromptText(options.role)
    );
  return rolePromptText(options.role, {
    system: buildSystemPrompt(""),
    features: [featuresText, projectWidgetsText].filter(Boolean).join("\n\n"),
    widgets: [widgetsFeature, projectWidgetsText].filter(Boolean).join("\n\n"),
    project: projectSection,
    memory: memory.trim(),
    skills: skillsText.trim(),
    mcp: mcpText.trim(),
    role: roleTemplateTitle(options.role),
    summary: summaryText.trim(),
  }).trim();
}
