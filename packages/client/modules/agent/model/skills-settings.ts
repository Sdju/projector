import { onMounted, ref, useId } from "vue";
import { commandArgs, useCommandScope } from "../../../common/utilities/commands.ts";
import { readAgentSkills, type AgentSkills } from "../api/skills.ts";

/** Skills and prompt commands the Projector agent finds in the user's folder and in a project. */
export function useAgentSkillsSettings() {
  const data = ref<AgentSkills>({ skills: [], folders: [] });
  const busy = ref(false);
  const error = ref("");
  const commands = useCommandScope(`agent-skills:${useId()}`, () => ({
    surface: "agentSkills",
    busy: busy.value,
    skills: data.value.skills.length,
  }));

  async function load(projectId?: string): Promise<AgentSkills> {
    busy.value = true;
    error.value = "";
    try {
      data.value = await readAgentSkills(projectId);
      return data.value;
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Ошибка навыков агента";
      throw err;
    } finally {
      busy.value = false;
    }
  }

  commands.scope.registerCommand({
    id: "ide.agent.skills.list",
    title: "Список навыков агента",
    description:
      "Возвращает навыки и команды-шаблоны штатного агента Projector: имя, описание, вид (skill или command), источник (user или project) и папки, где они лежат. С projectId — вместе с навыками проекта.",
    arguments: { projectId: "Проект, чьи навыки добавить; без него только пользовательские" },
    enabled: () => !busy.value,
    run: (value) => {
      const projectId = commandArgs(value).projectId;
      return load(typeof projectId === "string" ? projectId : undefined);
    },
  });
  onMounted(() => void load().catch(() => undefined));

  return { data, busy, error, commands };
}
