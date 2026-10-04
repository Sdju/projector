import {
  registerWorkspaceProfile,
  createLocalWorkspaceProfile,
} from "../../workspace-api/index.ts";
import { computed, reactive } from "vue";
import {
  createProject,
  deleteProject,
  fetchProject,
  fetchProjects,
  inspectPath,
  resolveProject,
  updateProject,
} from "../api/client.ts";
import type { ProcessSnapshot, Project, ProjectDraft } from "./types.ts";

const state = reactive({
  projects: [] as Project[],
  loading: false,
  error: "",
});

function registerEnvironment(project: Project) {
  if (!project.environment) return;
  const profile = createLocalWorkspaceProfile(project.id);
  profile.id = "docker";
  profile.features = { ...profile.features, docker: false, externalFiles: false };
  registerWorkspaceProfile(project.id, profile);
}
export function useProjects() {
  const projects = computed(() => state.projects);
  const loading = computed(() => state.loading);
  const error = computed(() => state.error);

  async function load(): Promise<void> {
    const initialIds = new Set(state.projects.map((project) => project.id));
    state.loading = true;
    state.error = "";
    try {
      const data = await fetchProjects();
      data.projects.forEach(registerEnvironment);
      // A path may be resolved while the initial catalog request is in flight.
      state.projects = [
        ...data.projects,
        ...state.projects.filter(
          (project) =>
            !initialIds.has(project.id) && !data.projects.some((item) => item.id === project.id),
        ),
      ];
    } catch (err) {
      state.error = err instanceof Error ? err.message : "Не удалось загрузить проекты";
    } finally {
      state.loading = false;
    }
  }

  async function add(draft: ProjectDraft): Promise<Project> {
    const data = await createProject(draft);
    state.projects.unshift(data.project);
    return data.project;
  }

  async function save(id: string, draft: Partial<ProjectDraft>): Promise<Project> {
    const data = await updateProject(id, draft);
    const index = state.projects.findIndex((item) => item.id === id);
    if (index !== -1) state.projects[index] = data.project;
    return data.project;
  }

  async function remove(id: string): Promise<void> {
    await deleteProject(id);
    state.projects = state.projects.filter((item) => item.id !== id);
  }

  async function getOne(id: string): Promise<Project> {
    const local = state.projects.find((item) => item.id === id);
    if (local) return local;
    const data = await fetchProject(id);
    return data.project;
  }

  function applyRuntime(snapshot: ProcessSnapshot): void {
    const project = state.projects.find((item) => item.id === snapshot.projectId);
    if (project) project.runtime = snapshot;
  }

  function ingest(project: Project): void {
    registerEnvironment(project);
    const index = state.projects.findIndex((item) => item.id === project.id);
    if (index === -1) state.projects.unshift(project);
    else state.projects[index] = project;
  }

  async function openPath(path: string): Promise<Project> {
    const data = await resolveProject(path);
    ingest(data.project);
    return data.project;
  }

  return {
    projects,
    loading,
    error,
    load,
    add,
    save,
    remove,
    getOne,
    inspect: inspectPath,
    applyRuntime,
    ingest,
    openPath,
  };
}

export function emptyDraft(): ProjectDraft {
  const command = { id: crypto.randomUUID(), name: "dev", cmd: "pnpm dev" };
  return {
    name: "",
    path: "",
    url: "http://localhost:5173",
    icon: "",
    mode: "server",
    defaultCommandId: command.id,
    commands: [command],
  };
}
