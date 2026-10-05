import { createRouter, createWebHistory } from "vue-router";
import GithubProjectPage from "../pages/gh/projects/[...githubPath].vue";
import ProjectPage from "../pages/projects/[...projectPath].vue";
import SettingsPage from "../pages/settings.vue";
import LauncherPage from "../pages/index.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "launcher", component: LauncherPage },
    { path: "/projects", redirect: "/" },
    { path: "/projects/:projectPath(.*)+", name: "project", component: ProjectPage },
    { path: "/gh/projects/:githubPath(.*)+", name: "github-project", component: GithubProjectPage },
    { path: "/settings", name: "settings", component: SettingsPage },
  ],
});
